import { describe, expect, it, vi } from "vitest";

import { assistantBridgeEventType } from "../../src/adapters/assistant-bridge/assistant-bridge-events.js";
import { AssistantBridgeEventBus } from "../../src/adapters/assistant-bridge/assistant-bridge-event-bus.js";

describe("AssistantBridgeEventBus", () => {
  it("publishes and unsubscribes listeners", () => {
    const bus = new AssistantBridgeEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    bus.emit({
      type: assistantBridgeEventType.queued,
      request_id: "req-1",
      thread_id: "thread-1",
      execution_id: null,
      emitted_at: new Date().toISOString()
    });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    bus.emit({
      type: assistantBridgeEventType.completed,
      request_id: "req-1",
      thread_id: "thread-1",
      execution_id: "exec-1",
      emitted_at: new Date().toISOString()
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
