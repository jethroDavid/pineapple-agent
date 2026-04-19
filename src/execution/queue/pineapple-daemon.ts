import { restoreTriggerEvent, type TriggerEvent } from "../contracts/trigger-event.js";
import { trace, traceError } from "../../utils/trace.js";

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
    trace("daemon", "started");
  }

  // Prevents new work from being accepted, then waits for the already queued work
  // to finish so shutdown is graceful instead of interrupting an in-flight job.
  async stop(): Promise<void> {
    this.started = false;
    trace("daemon", "stopping");
    await this.whenIdle();
    trace("daemon", "stopped");
  }

  // Request/response entrypoint for trigger handling. The caller awaits the result,
  // but the work still runs through the same serialized daemon queue as every
  // other job.
  async submitTrigger(triggerEvent: TriggerEvent): Promise<Result> {
    trace("daemon", "submit trigger", {
      triggerId: triggerEvent.trigger_id
    });
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
    trace("daemon", "enqueue trigger", {
      triggerId: triggerEvent.trigger_id
    });
    this.queueJob(this.createTriggerJob(triggerEvent), {
      onError,
      onSuccess
    });
  }

  // Generic serialized work entrypoint for non-trigger tasks that still must run
  // in order with trigger processing, such as recovery or approval resolution.
  async submitJob<T>(run: () => Promise<T>): Promise<T> {
    this.assertStarted();
    trace("daemon", "submit job");

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

    trace("daemon", "drain loop started", {
      queueDepth: this.queue.length
    });
    this.drainPromise = this.drainQueue().finally(() => {
      this.drainPromise = null;

      if (this.started && this.queue.length > 0) {
        this.ensureDrainLoop();
        return;
      }

      if (!this.processing && this.queue.length === 0) {
        trace("daemon", "drain loop finished");
        this.flushIdleWaiters();
      }
    });
  }

  // Processes queued jobs one at a time to preserve daemon ordering guarantees.
  private async drainQueue(): Promise<void> {
    this.processing = true;
    trace("daemon", "processing queue", {
      queueDepth: this.queue.length
    });

    while (this.queue.length > 0) {
      const entry = this.queue.shift();

      if (!entry) {
        continue;
      }

      await entry.run();
    }

    this.processing = false;
    trace("daemon", "queue idle");
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
    const queuedAt = Date.now();
    this.queue.push({
      run: async () => {
        trace("daemon", "job started", {
          queueDepth: this.queue.length
        });
        try {
          const result = await run();
          this.processedCount += 1;
          trace("daemon", "job succeeded", {
            durationMs: Date.now() - queuedAt,
            processedCount: this.processedCount,
            failedCount: this.failedCount
          });
          handlers.onSuccess?.(result);
        } catch (error) {
          this.failedCount += 1;
          traceError("daemon", "job failed", error, {
            durationMs: Date.now() - queuedAt,
            processedCount: this.processedCount,
            failedCount: this.failedCount
          });
          handlers.onError?.(error);
        }
      }
    });

    trace("daemon", "job queued", {
      queueDepth: this.queue.length
    });

    this.ensureDrainLoop();
  }
}
