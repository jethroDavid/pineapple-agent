import { describe, expect, it } from "vitest";

import { createThread } from "../../../src/threads/domain/thread.js";

describe("Thread", () => {
  it("creates an unbound thread by default", () => {
    const thread = createThread();

    expect(thread.subjectType).toBeNull();
    expect(thread.subjectId).toBeNull();
    expect(thread.title).toMatch(/^Thread:/);
    expect(thread.description).toBeNull();
    expect(thread.threadMetadata.provisionalTitle).toBe(true);
    expect(thread.threadMetadata.turnCount).toBe(0);
    expect(thread.threadMetadata.categories).toEqual([]);
    expect(thread.threadMetadata.enrichedAt).toBeNull();
    expect(thread.closedAt).toBeNull();
    expect(thread.lastResponseId).toBeNull();
  });

  it("preserves explicit title and marks it as non-provisional", () => {
    const thread = createThread({
      title: "Launch checklist"
    });

    expect(thread.title).toBe("Launch checklist");
    expect(thread.threadMetadata.provisionalTitle).toBe(false);
  });

  it("creates a bound thread when both subject fields are present", () => {
    const thread = createThread({
      subjectType: "shortcut_story",
      subjectId: "123"
    });

    expect(thread.subjectType).toBe("shortcut_story");
    expect(thread.subjectId).toBe("123");
  });

  it("rejects subjectType without subjectId", () => {
    expect(() =>
      createThread({
        subjectType: "shortcut_story"
      })
    ).toThrow(/subjectType and subjectId/);
  });

  it("rejects subjectId without subjectType", () => {
    expect(() =>
      createThread({
        subjectId: "123"
      })
    ).toThrow(/subjectType and subjectId/);
  });
});
