import { describe, expect, it } from "vitest";

import { AssistantBridgeRequestTracker } from "../../src/adapters/assistant-bridge/assistant-bridge-request-tracker.js";

describe("AssistantBridgeRequestTracker", () => {
  it("tracks per-thread request order and completion", () => {
    const tracker = new AssistantBridgeRequestTracker();

    tracker.start("req-1", "thread-1");
    tracker.start("req-2", "thread-1");
    tracker.start("req-3", "thread-2");

    expect(tracker.peekByThreadId("thread-1")).toBe("req-1");
    expect(tracker.peekByThreadId("thread-2")).toBe("req-3");

    tracker.complete("req-1");

    expect(tracker.peekByThreadId("thread-1")).toBe("req-2");
    expect(tracker.peekByThreadId("thread-2")).toBe("req-3");

    tracker.complete("req-2");
    tracker.complete("req-3");

    expect(tracker.peekByThreadId("thread-1")).toBeNull();
    expect(tracker.peekByThreadId("thread-2")).toBeNull();
  });
});
