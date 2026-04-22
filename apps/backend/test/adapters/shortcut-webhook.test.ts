import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createShortcutTriggerEvent,
  getShortcutWebhookSignature,
  normalizeShortcutWebhookDelivery,
  shouldIgnoreShortcutStoryComment,
  verifyShortcutWebhookSignature
} from "../../src/adapters/shortcut/shortcut-webhook.js";

describe("normalizeShortcutWebhookDelivery", () => {
  it("accepts a story creation delivery and normalizes the story subject", () => {
    const result = normalizeShortcutWebhookDelivery({
      id: 9001,
      primary_id: 123,
      member_id: "member-1",
      changed: "2026-04-11T12:00:00.000Z",
      actions: [
        {
          entity_type: "story",
          action: "create",
          id: 123
        }
      ]
    });

    expect(result).toEqual({
      kind: "accepted",
      deliveryId: "9001",
      eventType: "story.created",
      storyPublicId: "123",
      commentId: null,
      memberId: "member-1",
      receivedAt: "2026-04-11T12:00:00.000Z"
    });
  });

  it("accepts a comment delivery and resolves the comment id", () => {
    const result = normalizeShortcutWebhookDelivery({
      id: "9002",
      primary_id: 123,
      changed_at: "2026-04-11T12:05:00.000Z",
      actions: [
        {
          entity_type: "comment",
          action: "create",
          id: "5001",
          story_id: 123
        }
      ]
    });

    expect(result).toEqual({
      kind: "accepted",
      deliveryId: "9002",
      eventType: "comment.created",
      storyPublicId: "123",
      commentId: "5001",
      memberId: null,
      receivedAt: "2026-04-11T12:05:00.000Z"
    });
  });

  it("ignores non-material story updates that only change workflow state", () => {
    const result = normalizeShortcutWebhookDelivery({
      id: 9003,
      primary_id: 123,
      actions: [
        {
          entity_type: "story",
          action: "update",
          id: 123,
          changes: {
            workflow_state_id: 42
          }
        }
      ]
    });

    expect(result).toEqual({
      kind: "ignored",
      deliveryId: "9003",
      reason: "unsupported_delivery"
    });
  });
});

describe("Shortcut webhook helpers", () => {
  it("creates a subject-routed TriggerEvent with enriched Shortcut context", () => {
    const triggerEvent = createShortcutTriggerEvent({
      delivery: {
        kind: "accepted",
        deliveryId: "9004",
        eventType: "comment.created",
        storyPublicId: "123",
        commentId: "5001",
        memberId: "member-1",
        receivedAt: "2026-04-11T12:05:00.000Z"
      },
      story: {
        id: "123",
        name: "Add memory to the agent",
        description: "Copy open claw memory",
        app_url: "https://app.shortcut.com/pineapple/story/123",
        story_type: null,
        workflow_state_id: "2",
        labels: [
          {
            name: "agent"
          }
        ],
        comments: [
          {
            id: "5001",
            text: "Can you clarify the source memory?",
            author_id: "member-2",
            created_at: "2026-04-11T12:05:00.000Z",
            updated_at: "2026-04-11T12:05:00.000Z",
            app_url: null,
            author_profile: {
              name: "Jethro",
              mention_name: "jethro"
            }
          }
        ]
      },
      workflows: [
        {
          id: "workflow-1",
          name: "Default",
          states: [
            {
              id: "2",
              name: "In Progress"
            }
          ]
        }
      ],
      agentName: "pineapple"
    });

    expect(triggerEvent).toMatchObject({
      trigger_id: "shortcut:webhook:9004",
      source: {
        kind: "webhook",
        system: "shortcut",
        event_type: "comment.created"
      },
      actor: {
        type: "human",
        id: "member-2"
      },
      routing: {
        subject_type: "shortcut_story",
        subject_id: "123",
        allow_unbound_thread: false
      },
      received_at: "2026-04-11T12:05:00.000Z"
    });
    expect(triggerEvent.payload).toMatchObject({
      input: expect.stringContaining("Status: In Progress"),
      instructions: expect.stringContaining("shortcut_update_story")
    });
  });

  it("identifies self-authored agent comments so the adapter can avoid echo loops", () => {
    expect(
      shouldIgnoreShortcutStoryComment(
        {
          id: "5002",
          text: "[agent:pineapple] I need more context.",
          author_id: "member-1",
          created_at: null,
          updated_at: null,
          app_url: null,
          author_profile: null
        },
        "pineapple"
      )
    ).toBe(true);
  });

  it("verifies signatures against the raw request body", () => {
    const rawBody = Buffer.from(JSON.stringify({
      id: 1
    }));
    const signature = createHmac("sha256", "shortcut-secret")
      .update(rawBody)
      .digest("hex");

    expect(
      verifyShortcutWebhookSignature({
        rawBody,
        secret: "shortcut-secret",
        signature
      })
    ).toBe(true);
    expect(
      getShortcutWebhookSignature({
        "payload-signature": signature
      })
    ).toBe(signature);
  });
});
