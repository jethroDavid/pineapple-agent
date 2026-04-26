import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCronAdapter } from "../../src/adapters/cron/cron-adapter.js";
import type { TriggerEvent } from "../../src/execution/contracts/trigger-event.js";
import type { AppExecutionService } from "../../src/execution/pipeline/service.js";

describe("createCronAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when cron is not enabled and has no configured jobs", () => {
    expect(createCronAdapter({})).toBeNull();
  });

  it("fires configured cron jobs and enqueues trigger events", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const adapter = createCronAdapter({
      enabled: true,
      jobsJson: JSON.stringify([
        {
          id: "heartbeat",
          expression: "*/2 * * * * *",
          message: "Heartbeat reminder",
          allow_unbound_thread: true,
          agent_id: "codex"
        }
      ])
    });

    expect(adapter).not.toBeNull();

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: createFakeExecutionService(enqueuedTriggers)
    });

    await vi.advanceTimersByTimeAsync(2100);

    expect(enqueuedTriggers).toHaveLength(1);
    expect(enqueuedTriggers[0]).toMatchObject({
      source: {
        kind: "system",
        system: "pineapple-cron",
        event_type: "reminder.tick"
      },
      payload: {
        input: expect.stringContaining("Reminder: Heartbeat reminder"),
        agent_id: "codex"
      },
      routing: {
        allow_unbound_thread: true
      }
    });
  });
});

function createFakeExecutionService(
  enqueuedTriggers: TriggerEvent[]
): AppExecutionService {
  return {
    getQueueStatus() {
      return {
        state: "idle",
        queueDepth: 0,
        processedCount: 0,
        failedCount: 0
      };
    },
    canResolveDecisions() {
      return false;
    },
    listAgents() {
      return [];
    },
    getAgentSummary() {
      return null;
    },
    hasAgent() {
      return false;
    },
    getEntrypointAgentId() {
      return null;
    },
    async submitTrigger() {
      throw new Error("Not used in cron adapter test.");
    },
    enqueueTrigger(triggerEvent) {
      enqueuedTriggers.push(triggerEvent);
    },
    async runTurn() {
      throw new Error("Not used in cron adapter test.");
    },
    async resolveDecision() {
      throw new Error("Not used in cron adapter test.");
    },
    async recoverActiveRuns() {
      return [];
    }
  };
}

function createFakeLogger() {
  return {
    level: "info",
    silent: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    child: vi.fn()
  } as never;
}
