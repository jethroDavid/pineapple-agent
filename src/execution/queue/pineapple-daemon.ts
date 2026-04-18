import { restoreTriggerEvent, type TriggerEvent } from "../contracts/trigger-event.js";

export const daemonState = {
  stopped: "stopped",
  idle: "idle",
  processing: "processing"
} as const;

type DaemonState = (typeof daemonState)[keyof typeof daemonState];

export interface PineappleDaemonStatus {
  state: DaemonState;
  queueDepth: number;
  processedCount: number;
  failedCount: number;
}

interface QueuedJob {
  run: () => Promise<void>;
}

interface QueueJobHandlers<T> {
  onSuccess?(result: T): void;
  onError?(error: unknown): void;
}

export class PineappleDaemon<Result> {
  private readonly queue: QueuedJob[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private drainPromise: Promise<void> | null = null;
  private started = false;
  private processing = false;
  private processedCount = 0;
  private failedCount = 0;

  constructor(
    private readonly handleTrigger: (triggerEvent: TriggerEvent) => Promise<Result>
  ) {}

  // Enables queue processing. Work submitted before start() is rejected so callers
  // do not silently queue work against an uninitialized runtime.
  start(): void {
    this.started = true;
  }

  // Prevents new work from being accepted, then waits for the already queued work
  // to finish so shutdown is graceful instead of interrupting an in-flight job.
  async stop(): Promise<void> {
    this.started = false;
    await this.whenIdle();
  }

  // Request/response entrypoint for trigger handling. The caller awaits the result,
  // but the work still runs through the same serialized daemon queue as every
  // other job.
  async submitTrigger(triggerEvent: TriggerEvent): Promise<Result> {
    return await this.submitJob(this.createTriggerJob(triggerEvent));
  }

  // Detached trigger entrypoint for fire-and-forget flows such as webhooks. It
  // uses the same queue as submitTrigger(), but reports completion through
  // callbacks instead of returning a Promise to await.
  enqueueTrigger(
    triggerEvent: TriggerEvent,
    onError?: (error: unknown) => void,
    onSuccess?: (result: Result) => void
  ): void {
    this.assertStarted();
    this.queueJob(this.createTriggerJob(triggerEvent), {
      onError,
      onSuccess
    });
  }

  // Generic serialized work entrypoint for non-trigger tasks that still must run
  // in order with trigger processing, such as recovery or approval resolution.
  async submitJob<T>(run: () => Promise<T>): Promise<T> {
    this.assertStarted();

    return await new Promise<T>((resolve, reject) => {
      this.queueJob(run, {
        onError: reject,
        onSuccess: resolve
      });
    });
  }

  getStatus(): PineappleDaemonStatus {
    return {
      state: this.getState(),
      queueDepth: this.queue.length,
      processedCount: this.processedCount,
      failedCount: this.failedCount
    };
  }

  // Resolves immediately when no work is active. Otherwise it waits until both
  // the queue and the currently running job are fully drained.
  async whenIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  // Ensures exactly one drain loop is active. If new work arrives during the
  // handoff from one loop finishing to the next starting, the finally block
  // restarts draining before any idle waiters are released.
  private ensureDrainLoop(): void {
    if (this.drainPromise !== null) {
      return;
    }

    this.drainPromise = this.drainQueue().finally(() => {
      this.drainPromise = null;

      if (this.started && this.queue.length > 0) {
        this.ensureDrainLoop();
        return;
      }

      if (!this.processing && this.queue.length === 0) {
        this.flushIdleWaiters();
      }
    });
  }

  // Processes queued jobs one at a time to preserve daemon ordering guarantees.
  private async drainQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();

      if (!entry) {
        continue;
      }

      await entry.run();
    }

    this.processing = false;
  }

  // Releases all pending whenIdle() callers once the daemon is fully drained.
  private flushIdleWaiters(): void {
    while (this.idleWaiters.length > 0) {
      const waiter = this.idleWaiters.shift();
      waiter?.();
    }
  }

  // Exposes a coarse operational state for health/status endpoints.
  private getState(): DaemonState {
    if (!this.started) {
      return daemonState.stopped;
    }

    if (this.processing || this.queue.length > 0) {
      return daemonState.processing;
    }

    return daemonState.idle;
  }

  // Normalizes incoming trigger data once before the job is queued so queue
  // execution always sees a validated TriggerEvent shape.
  private createTriggerJob(triggerEvent: TriggerEvent): () => Promise<Result> {
    const normalizedTriggerEvent = restoreTriggerEvent(triggerEvent);

    return () => this.handleTrigger(normalizedTriggerEvent);
  }

  // Centralizes the daemon lifecycle guard used by all public submission APIs.
  private assertStarted(): void {
    if (!this.started) {
      throw new Error("Daemon is not started.");
    }
  }

  // Wraps a job so the daemon can keep uniform success/failure counters and
  // notify the appropriate completion handlers without breaking the drain loop.
  private queueJob<T>(run: () => Promise<T>, handlers: QueueJobHandlers<T>): void {
    this.queue.push({
      run: async () => {
        try {
          const result = await run();
          this.processedCount += 1;
          handlers.onSuccess?.(result);
        } catch (error) {
          this.failedCount += 1;
          handlers.onError?.(error);
        }
      }
    });

    this.ensureDrainLoop();
  }
}
