import { describe, expect, it } from "vitest";

import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind
} from "../../../src/execution/contracts/trigger-event.js";
import { closeThread } from "../../../src/threads/domain/thread.js";
import {
  routeTriggerEvent,
  TriggerRoutingError,
  triggerRouteKind
} from "../../../src/execution/routing/route-trigger-event.js";
import { InMemoryThreadStore } from "../../support/in-memory-thread-store.js";

describe("routeTriggerEvent", () => {
  it("routes directly by thread_id when present", async () => {
    const threadStore = new InMemoryThreadStore();
    const existingThread = await threadStore.create({
      subjectType: "shortcut_story",
      subjectId: "123"
    });

    const result = await routeTriggerEvent(
      createTriggerEvent({
        trigger_id: "cli:existing-thread",
        source: {
          kind: triggerSourceKind.cli,
          system: "pineapple-cli",
          event_type: "command.invoked"
        },
        actor: {
          type: triggerActorType.human,
          id: "jethro"
        },
        routing: {
          thread_id: existingThread.threadId,
          subject_type: "ignored_subject",
          subject_id: "ignored_id"
        },
        payload: {}
      }),
      { threadStore }
    );

    expect(result.kind).toBe(triggerRouteKind.directThread);
    expect(result.thread.threadId).toBe(existingThread.threadId);
  });

  it("rejects a direct route when the target thread does not exist", async () => {
    const threadStore = new InMemoryThreadStore();

    await expect(
      routeTriggerEvent(
        createTriggerEvent({
          trigger_id: "cli:missing-thread",
          source: {
            kind: triggerSourceKind.cli,
            system: "pineapple-cli",
            event_type: "command.invoked"
          },
          actor: {
            type: triggerActorType.human,
            id: "jethro"
          },
          routing: {
            thread_id: crypto.randomUUID()
          },
          payload: {}
        }),
        { threadStore }
      )
    ).rejects.toThrow(TriggerRoutingError);
  });

  it("reuses the active thread for matching subject routing", async () => {
    const threadStore = new InMemoryThreadStore();
    const existingThread = await threadStore.create({
      subjectType: "shortcut_story",
      subjectId: "123"
    });

    const result = await routeTriggerEvent(
      createTriggerEvent({
        trigger_id: "webhook:subject-match",
        source: {
          kind: triggerSourceKind.webhook,
          system: "shortcut",
          event_type: "story.updated"
        },
        actor: {
          type: triggerActorType.system,
          id: "shortcut"
        },
        routing: {
          subject_type: "shortcut_story",
          subject_id: "123"
        },
        payload: {}
      }),
      { threadStore }
    );

    expect(result.kind).toBe(triggerRouteKind.subjectMatch);
    expect(result.thread.threadId).toBe(existingThread.threadId);
    expect(threadStore.records.size).toBe(1);
  });

  it("creates a new bound thread when no subject match exists", async () => {
    const threadStore = new InMemoryThreadStore();

    const result = await routeTriggerEvent(
      createTriggerEvent({
        trigger_id: "webhook:subject-create",
        source: {
          kind: triggerSourceKind.webhook,
          system: "shortcut",
          event_type: "story.created"
        },
        actor: {
          type: triggerActorType.system,
          id: "shortcut"
        },
        routing: {
          subject_type: "shortcut_story",
          subject_id: "456"
        },
        payload: {}
      }),
      { threadStore }
    );

    expect(result.kind).toBe(triggerRouteKind.subjectCreate);
    expect(result.thread.subjectType).toBe("shortcut_story");
    expect(result.thread.subjectId).toBe("456");
    expect(threadStore.records.size).toBe(1);
  });

  it("reopens and reuses a closed thread for matching subject routing", async () => {
    const threadStore = new InMemoryThreadStore();
    const existingThread = await threadStore.create({
      subjectType: "shortcut_story",
      subjectId: "789"
    });
    await threadStore.update(closeThread(existingThread, new Date("2026-04-11T00:00:00.000Z")));

    const result = await routeTriggerEvent(
      createTriggerEvent({
        trigger_id: "webhook:subject-reopen",
        source: {
          kind: triggerSourceKind.webhook,
          system: "shortcut",
          event_type: "comment.created"
        },
        actor: {
          type: triggerActorType.human,
          id: "member-1"
        },
        routing: {
          subject_type: "shortcut_story",
          subject_id: "789"
        },
        payload: {}
      }),
      { threadStore }
    );

    expect(result.kind).toBe(triggerRouteKind.subjectMatch);
    expect(result.thread.threadId).toBe(existingThread.threadId);
    expect(result.thread.closedAt).toBeNull();
  });

  it("creates an unbound thread only when the trigger explicitly allows it", async () => {
    const threadStore = new InMemoryThreadStore();

    const result = await routeTriggerEvent(
      createTriggerEvent({
        trigger_id: "system:recovery",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-daemon",
          event_type: "recovery.tick"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-daemon"
        },
        routing: {
          allow_unbound_thread: true
        },
        payload: {}
      }),
      { threadStore }
    );

    expect(result.kind).toBe(triggerRouteKind.unboundCreate);
    expect(result.thread.subjectType).toBeNull();
    expect(result.thread.subjectId).toBeNull();
  });
});
