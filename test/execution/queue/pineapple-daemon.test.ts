import { describe, expect, it } from "vitest";

import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind
} from "../../../src/execution/contracts/trigger-event.js";
import { daemonState, PineappleDaemon } from "../../../src/execution/queue/pineapple-daemon.js";

describe("PineappleDaemon", () => {
  it("processes submitted triggers sequentially", async () => {
    const events: string[] = [];
    const daemon = new PineappleDaemon(async (triggerEvent) => {
      events.push(`start:${triggerEvent.trigger_id}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`end:${triggerEvent.trigger_id}`);
      return triggerEvent.trigger_id;
    });

    daemon.start();

    const first = daemon.submitTrigger(
      createTriggerEvent({
        trigger_id: "trigger-1",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-daemon",
          event_type: "test"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-daemon"
        },
        routing: {
          allow_unbound_thread: true
        },
        payload: {
          input: "one"
        }
      })
    );
    const second = daemon.submitTrigger(
      createTriggerEvent({
        trigger_id: "trigger-2",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-daemon",
          event_type: "test"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-daemon"
        },
        routing: {
          allow_unbound_thread: true
        },
        payload: {
          input: "two"
        }
      })
    );

    await expect(first).resolves.toBe("trigger-1");
    await expect(second).resolves.toBe("trigger-2");
    await daemon.whenIdle();

    expect(events).toEqual([
      "start:trigger-1",
      "end:trigger-1",
      "start:trigger-2",
      "end:trigger-2"
    ]);
    expect(daemon.getStatus()).toEqual({
      state: daemonState.idle,
      queueDepth: 0,
      processedCount: 2,
      failedCount: 0
    });
  });

  it("rejects submissions when the daemon is not started", async () => {
    const daemon = new PineappleDaemon(async () => "ok");

    await expect(
      daemon.submitTrigger(
        createTriggerEvent({
          trigger_id: "trigger-1",
          source: {
            kind: triggerSourceKind.system,
            system: "pineapple-daemon",
            event_type: "test"
          },
          actor: {
            type: triggerActorType.system,
            id: "pineapple-daemon"
          },
          routing: {
            allow_unbound_thread: true
          },
          payload: {
            input: "one"
          }
        })
      )
    ).rejects.toThrow(/not started/);
  });

  it("tracks failed trigger executions", async () => {
    const daemon = new PineappleDaemon(async () => {
      throw new Error("runner failed");
    });

    daemon.start();

    await expect(
      daemon.submitTrigger(
        createTriggerEvent({
          trigger_id: "trigger-1",
          source: {
            kind: triggerSourceKind.system,
            system: "pineapple-daemon",
            event_type: "test"
          },
          actor: {
            type: triggerActorType.system,
            id: "pineapple-daemon"
          },
          routing: {
            allow_unbound_thread: true
          },
          payload: {
            input: "one"
          }
        })
      )
    ).rejects.toThrow(/runner failed/);

    await daemon.whenIdle();

    expect(daemon.getStatus()).toEqual({
      state: daemonState.idle,
      queueDepth: 0,
      processedCount: 0,
      failedCount: 1
    });
  });

  it("does not lose a trigger submitted during the drain-loop handoff", async () => {
    let hasQueuedFollowUp = false;
    let daemon: PineappleDaemon<string>;

    daemon = new PineappleDaemon(async (triggerEvent) => {
      if (!hasQueuedFollowUp) {
        hasQueuedFollowUp = true;

        queueMicrotask(() => {
          void daemon.submitTrigger(
            createTriggerEvent({
              trigger_id: "trigger-2",
              source: {
                kind: triggerSourceKind.system,
                system: "pineapple-daemon",
                event_type: "test"
              },
              actor: {
                type: triggerActorType.system,
                id: "pineapple-daemon"
              },
              routing: {
                allow_unbound_thread: true
              },
              payload: {
                input: "two"
              }
            })
          );
        });
      }

      return triggerEvent.trigger_id;
    });

    daemon.start();

    await expect(
      daemon.submitTrigger(
        createTriggerEvent({
          trigger_id: "trigger-1",
          source: {
            kind: triggerSourceKind.system,
            system: "pineapple-daemon",
            event_type: "test"
          },
          actor: {
            type: triggerActorType.system,
            id: "pineapple-daemon"
          },
          routing: {
            allow_unbound_thread: true
          },
          payload: {
            input: "one"
          }
        })
      )
    ).resolves.toBe("trigger-1");

    await daemon.whenIdle();

    expect(daemon.getStatus()).toEqual({
      state: daemonState.idle,
      queueDepth: 0,
      processedCount: 2,
      failedCount: 0
    });
  });

  it("tracks failures for detached trigger processing", async () => {
    let capturedError: unknown = null;
    const daemon = new PineappleDaemon(async () => {
      throw new Error("runner failed");
    });

    daemon.start();

    daemon.enqueueTrigger(
      createTriggerEvent({
        trigger_id: "trigger-1",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-daemon",
          event_type: "test"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-daemon"
        },
        routing: {
          allow_unbound_thread: true
        },
        payload: {
          input: "one"
        }
      }),
      (error) => {
        capturedError = error;
      }
    );

    await daemon.whenIdle();

    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe("runner failed");
    expect(daemon.getStatus()).toEqual({
      state: daemonState.idle,
      queueDepth: 0,
      processedCount: 0,
      failedCount: 1
    });
  });

  it("supports success callbacks for detached trigger processing", async () => {
    let capturedResult: string | null = null;
    const daemon = new PineappleDaemon(async (triggerEvent) => triggerEvent.trigger_id);

    daemon.start();

    daemon.enqueueTrigger(
      createTriggerEvent({
        trigger_id: "trigger-1",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-daemon",
          event_type: "test"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-daemon"
        },
        routing: {
          allow_unbound_thread: true
        },
        payload: {
          input: "one"
        }
      }),
      undefined,
      (result) => {
        capturedResult = result;
      }
    );

    await daemon.whenIdle();

    expect(capturedResult).toBe("trigger-1");
    expect(daemon.getStatus()).toEqual({
      state: daemonState.idle,
      queueDepth: 0,
      processedCount: 1,
      failedCount: 0
    });
  });
});
