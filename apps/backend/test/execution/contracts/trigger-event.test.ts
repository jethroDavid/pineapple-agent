import { describe, expect, it } from "vitest";

import {
  allowsUnboundThread,
  createTriggerEvent,
  hasDirectThreadRouting,
  hasSubjectRouting,
  triggerActorType,
  triggerEventVersion,
  triggerSourceKind
} from "../../../src/execution/contracts/trigger-event.js";

describe("TriggerEvent", () => {
  it("creates a trigger event with direct thread routing", () => {
    const triggerEvent = createTriggerEvent({
      trigger_id: "cli:run:1",
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
        thread_id: "f84f61d3-465d-42aa-bf8f-9e3949713fb5"
      },
      payload: {
        command: "ask"
      }
    });

    expect(triggerEvent.version).toBe(triggerEventVersion);
    expect(hasDirectThreadRouting(triggerEvent)).toBe(true);
    expect(hasSubjectRouting(triggerEvent)).toBe(false);
    expect(allowsUnboundThread(triggerEvent)).toBe(false);
    expect(triggerEvent.received_at).toMatch(/Z$/);
  });

  it("creates a trigger event with subject routing", () => {
    const triggerEvent = createTriggerEvent({
      trigger_id: "shortcut:webhook:123",
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
      payload: {
        storyId: 123
      }
    });

    expect(hasDirectThreadRouting(triggerEvent)).toBe(false);
    expect(hasSubjectRouting(triggerEvent)).toBe(true);
    expect(allowsUnboundThread(triggerEvent)).toBe(false);
  });

  it("creates an explicit unbound trigger event", () => {
    const triggerEvent = createTriggerEvent({
      trigger_id: "system:cron:recovery",
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
      payload: {
        reason: "recovery"
      }
    });

    expect(hasDirectThreadRouting(triggerEvent)).toBe(false);
    expect(hasSubjectRouting(triggerEvent)).toBe(false);
    expect(allowsUnboundThread(triggerEvent)).toBe(true);
  });

  it("rejects subject_type without subject_id", () => {
    expect(() =>
      createTriggerEvent({
        trigger_id: "bad:subject-type-only",
        source: {
          kind: triggerSourceKind.http,
          system: "pineapple-api",
          event_type: "message.received"
        },
        actor: {
          type: triggerActorType.unknown,
          id: "anonymous"
        },
        routing: {
          subject_type: "shortcut_story"
        },
        payload: null
      })
    ).toThrow(/subject_type and subject_id/);
  });

  it("rejects empty routing unless unbound thread handling is explicit", () => {
    expect(() =>
      createTriggerEvent({
        trigger_id: "bad:unbound",
        source: {
          kind: triggerSourceKind.cli,
          system: "pineapple-cli",
          event_type: "command.invoked"
        },
        actor: {
          type: triggerActorType.human,
          id: "jethro"
        },
        routing: {},
        payload: {
          command: "ask"
        }
      })
    ).toThrow(/allow_unbound_thread=true/);
  });
});
