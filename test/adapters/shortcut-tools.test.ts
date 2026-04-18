import { describe, expect, it, vi } from "vitest";

import { ShortcutClient } from "../../src/adapters/shortcut/shortcut-client.js";
import { createShortcutCreateStoryTool } from "../../src/adapters/shortcut/shortcut-create-story-tool.js";
import { createShortcutPostCommentTool } from "../../src/adapters/shortcut/shortcut-post-comment-tool.js";
import { createShortcutUpdateStoryTool } from "../../src/adapters/shortcut/shortcut-update-story-tool.js";

describe("Shortcut tools", () => {
  it("creates a story by resolving the named workflow state first", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return [
            {
              id: 1,
              name: "Default",
              states: [
                {
                  id: 2,
                  name: "In Progress"
                }
              ]
            }
          ];
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return {
            id: 123,
            name: "Add memory to the agent",
            description: "Copy open claw memory",
            workflow_state_id: 2,
            story_type: "feature",
            app_url: "https://app.shortcut.com/pineapple/story/123"
          };
        }
      });
    const client = new ShortcutClient({
      apiToken: "shortcut-token",
      fetchImplementation: fetchImplementation as typeof fetch
    });
    const tool = createShortcutCreateStoryTool({
      client
    });

    const result = await tool.execute({
      name: "Add memory to the agent",
      description: "Copy open claw memory",
      workflow_state_name: "In Progress",
      story_type: "feature"
    });

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://api.app.shortcut.com/api/v3/workflows",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "Shortcut-Token": "shortcut-token"
        }
      })
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://api.app.shortcut.com/api/v3/stories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Add memory to the agent",
          description: "Copy open claw memory",
          story_type: "feature",
          workflow_state_id: 2
        })
      })
    );
    expect(result).toEqual({
      ok: true,
      story_public_id: "123",
      name: "Add memory to the agent",
      description: "Copy open claw memory",
      workflow_state_id: "2",
      workflow_state_name: "In Progress",
      story_type: "feature",
      app_url: "https://app.shortcut.com/pineapple/story/123"
    });
  });

  it("posts agent-prefixed comments to Shortcut", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          id: 5001,
          text: "[agent:pineapple] Investigating the requested memory source."
        };
      }
    });
    const client = new ShortcutClient({
      apiToken: "shortcut-token",
      fetchImplementation: fetchImplementation as typeof fetch
    });
    const tool = createShortcutPostCommentTool({
      agentName: "pineapple",
      client
    });

    const result = await tool.execute({
      story_public_id: "123",
      text: "Investigating the requested memory source."
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.app.shortcut.com/api/v3/stories/123/comments",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Shortcut-Token": "shortcut-token"
        },
        body: JSON.stringify({
          text: "[agent:pineapple] Investigating the requested memory source."
        })
      })
    );
    expect(result).toEqual({
      ok: true,
      story_public_id: "123",
      comment_id: "5001",
      text: "[agent:pineapple] Investigating the requested memory source."
    });
  });

  it("updates a story by resolving the named workflow state first", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return [
            {
              id: 1,
              name: "Default",
              states: [
                {
                  id: 2,
                  name: "In Progress"
                }
              ]
            }
          ];
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return {
            id: 123,
            name: "Add memory to the agent",
            description: "Copy open claw memory",
            workflow_state_id: 2,
            story_type: "feature",
            app_url: "https://app.shortcut.com/pineapple/story/123"
          };
        }
      });
    const client = new ShortcutClient({
      apiToken: "shortcut-token",
      fetchImplementation: fetchImplementation as typeof fetch
    });
    const tool = createShortcutUpdateStoryTool({
      client
    });

    const result = await tool.execute({
      story_public_id: "123",
      name: "Add memory to the agent",
      description: "Copy open claw memory",
      workflow_state_name: "In Progress",
      story_type: "feature"
    });

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://api.app.shortcut.com/api/v3/workflows",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "Shortcut-Token": "shortcut-token"
        }
      })
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://api.app.shortcut.com/api/v3/stories/123",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Add memory to the agent",
          description: "Copy open claw memory",
          story_type: "feature",
          workflow_state_id: 2
        })
      })
    );
    expect(result).toEqual({
      ok: true,
      story_public_id: "123",
      name: "Add memory to the agent",
      description: "Copy open claw memory",
      workflow_state_id: "2",
      workflow_state_name: "In Progress",
      story_type: "feature",
      app_url: "https://app.shortcut.com/pineapple/story/123"
    });
  });
});
