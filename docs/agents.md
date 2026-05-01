# Pineapple Agents

Pineapple agents are defined by manifest files under `apps/backend/.pineapple/agents`.
The manifest system is the source of truth for agent creation, tool access, delegation,
listing, direct HTTP runs, and Telegram agent selection.

## Creating an agent

A new agent needs two files:

```text
apps/backend/.pineapple/agents/<agent-id>.json
apps/backend/.pineapple/agents/prompts/<agent-id>.md
```

After the backend runtime starts, every valid manifest appears in:

```http
GET /agents
GET /agents/:agentId
POST /agents/:agentId/runs
```

Telegram also lists manifest agents through `/agents` and can select a direct agent
with `/agent <agent-id>`. Use `/agent auto` to return to the default entrypoint.

No new HTTP route code is required for a new agent.

## Manifest fields

```json
{
  "id": "researcher",
  "name": "Researcher",
  "description": "Research specialist for current factual questions.",
  "handoffDescription": "Handles research tasks that need web search and concise synthesis.",
  "instructionsFile": "./prompts/researcher.md",
  "modelPreset": "app",
  "toolsets": ["telegram"],
  "hostedTools": [
    {
      "type": "web_search"
    }
  ],
  "handoffs": [],
  "agentTools": [],
  "entrypoint": false
}
```

- `id`: stable API and Telegram id. Use lowercase snake case.
- `name`: display name passed to the Agents SDK.
- `description`: human-facing listing text.
- `handoffDescription`: model-facing delegation text.
- `instructionsFile`: prompt markdown path, relative to the manifest file.
- `model`: exact model override.
- `modelPreset`: `app` for the normal app model or `codex` for the configured Codex model.
- `toolsets`: local app tool groups this agent can use.
- `hostedTools`: OpenAI-hosted tools such as `web_search`.
- `mcpServers`: agent-specific MCP servers.
- `sessionBackend`: optional provider-side session backend, currently `codex_mcp`.
- `handoffs`: agents this agent can transfer conversation control to.
- `agentTools`: agents this agent can call as tools named `ask_<agent-id>`.
- `entrypoint`: exactly one manifest must be the default entrypoint.

## Toolsets

Toolsets are explicit. An agent only receives the toolsets named in its manifest.

- `app`: all app adapter tools.
- `telegram`: Telegram outbound tools.
- `shortcut`: Shortcut story/comment tools.
- `cron`: reminder scheduling tools.
- `assistant_audio_bridge`: mobile/audio bridge and Spotify playback tools. Root delegates here for Spotify control, including from Telegram auto mode.

Use `app` only when the agent should intentionally receive every app adapter tool.
Root orchestration agents should usually use `toolsets: []`.

## Delegation styles

Use `handoffs` when the target specialist should take over the conversation. The
SDK exposes handoffs as transfer tools such as `transfer_to_codex`.

Use `agentTools` when the caller should keep control and ask another agent for a
focused result. Pineapple exposes these tools as `ask_<agent-id>`, for example
`ask_scheduler`.

An agent may use both, but prompts should say when to transfer versus when to ask.

## Direct runs

Run any manifest agent directly:

```bash
curl -X POST http://localhost:3000/agents/researcher/runs \
  -H "content-type: application/json" \
  -d '{"input":"Summarize the latest status of this API."}'
```

Continue an existing Pineapple thread with a specific agent:

```bash
curl -X POST http://localhost:3000/agents/researcher/runs \
  -H "content-type: application/json" \
  -d '{"thread_id":"00000000-0000-0000-0000-000000000000","input":"Continue."}'
```

The older generic route remains supported:

```http
POST /agents/runs
{
  "agent_id": "researcher",
  "input": "..."
}
```

## One-shot agent creation prompt

Use this prompt with Codex when adding a new specialist:

```text
Create a new Pineapple agent.

Agent id:
<lowercase_snake_case_id>

Display name:
<name>

Purpose:
<what this agent owns>

Tools:
<toolsets and hosted tools it should receive>

Delegation:
<handoffs and agentTools, or "none">

Prompt behavior:
<style, boundaries, output contract, and tool-use rules>

Implementation requirements:
- Add one manifest JSON under apps/backend/.pineapple/agents.
- Add one prompt markdown file under apps/backend/.pineapple/agents/prompts.
- Use explicit toolsets only; do not use "app" unless this agent should receive every adapter tool.
- Do not change HTTP route code. The dynamic /agents/:agentId/runs route must pick it up automatically.
- Add or update focused tests if this changes manifest validation or bundled agent behavior.
- Run the relevant backend tests and TypeScript check.
```
