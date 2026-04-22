# Pineapple

Minimal development scaffold for a thread-first agent system.

## Requirements
- Node.js 22+
- pnpm
- PostgreSQL 16

## Setup
```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

To enable the daemon-backed trigger endpoint, set both `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`.
Set `RECOVERY_ENABLED=false` during local testing if you want to skip replaying previously active runs on startup.
Set `EXECUTION_TURN_TIMEOUT_MS` to cap a single agent turn runtime (default `180000`) so one hung turn cannot block the daemon queue indefinitely.

To enable OpenAI web search for an agent, add a hosted tool in that agent manifest:

```json
{
  "hostedTools": [
    {
      "type": "web_search"
    }
  ]
}
```

To enable cron reminders (including second-level schedules), set:

```bash
CRON_ENABLED=true
# optional: bootstrap jobs on startup
# CRON_JOBS_JSON=[{"id":"heartbeat","expression":"*/30 * * * * *","message":"Heartbeat","allow_unbound_thread":true}]
```

Agent scheduling tool:

- `cron_schedule_reminder` now takes a cron `expression` directly (seconds supported).
- Set `one_time=true` to guarantee a single fire (will not repeat).
- Set `one_time=false` for recurring schedules.

Console tracing:

- Set `TRACE_CONSOLE=true` to print `[scope] ...` traces for daemon, runner, tools, and adapters.

Assistant bridge (temporary desktop ingress + mock stream for future app migration):

- Set `ASSISTANT_BRIDGE_ENABLED=true`.
- Configure Spotify + OpenAI TTS env values (`ASSISTANT_BRIDGE_SPOTIFY_*`, `ASSISTANT_BRIDGE_OPENAI_TTS_*`) and `OPENAI_API_KEY`.
- Ensure your Spotify token has playback scopes: `user-modify-playback-state` and `user-read-playback-state`.
- Optional: tune post-TTS resume delay with `ASSISTANT_BRIDGE_TTS_RESUME_PADDING_MS` (default `2000`).
- Submit local requests via `POST /adapters/assistant-bridge/request`.
- Subscribe to stream events via `GET /adapters/assistant-bridge/ws` (SSE event stream).
- Save/replay streamed TTS audio locally:
  - `pnpm assistant-bridge:listen`
  - with auto-open player: `pnpm assistant-bridge:listen -- --autoplay`

## Runtime Endpoints
```bash
GET /health
GET /daemon
POST /triggers
POST /adapters/assistant-bridge/request
GET /adapters/assistant-bridge/ws
```

## Useful Commands
```bash
pnpm check
pnpm build
pnpm test
pnpm test:watch
pnpm db:up
pnpm db:down
pnpm db:status
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```
 curl -X POST http://localhost:3000/adapters/assistant-bridge/request -H "content-type: application/json" -d "{\"text\":\"die on this hill by sienna\"}"
 
 
 curl -X POST http://localhost:3000/adapters/assistant-bridge/request -H "content-type: application/json" -d "{\"text\":\"what is the current situation in the Strait of Hormuz?\"}"