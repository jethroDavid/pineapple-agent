# Pineapple

Minimal development scaffold for a thread-first agent system.

## Requirements
- Node.js 22+
- pnpm
- PostgreSQL 16

## Setup
```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Windows one-command local flow with Tailscale Funnel + optional Spotify auth:

```bash
pnpm dev:easy
```

`dev:easy` keeps `pnpm dev` unchanged and expects Funnel route `/ -> http://127.0.0.1:3000`. If Funnel is missing, it auto-runs `tailscale funnel --bg <port>` and rechecks. If `ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID` is set, `dev:easy` also validates Spotify tokens and runs interactive OAuth when needed.

`dev:easy` backend target is configurable with:
- `DEV_EASY_BACKEND_HOST` (default `127.0.0.1`)
- `DEV_EASY_BACKEND_PORT` (default `3000`)

To enable the daemon-backed trigger endpoint, set both `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`.
Set `RECOVERY_ENABLED=false` during local testing if you want to skip replaying previously active runs on startup.
Set `EXECUTION_TURN_TIMEOUT_MS` to cap a single agent turn runtime (default `180000`) so one hung turn cannot block the daemon queue indefinitely.
Set `PINEAPPLE_PROJECT_ROOT` to control the default repository workdir for agent MCP servers such as Codex. When unset, Pineapple uses the nearest workspace root it can find.

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

- `cron_list_jobs` lists active cron jobs/reminders with their job IDs and next run times.
- `cron_delete_job` deletes an active cron job/reminder by `job_id`.
- `cron_schedule_reminder` now takes a cron `expression` directly (seconds supported).
- Set `one_time=true` to guarantee a single fire (will not repeat).
- Set `one_time=false` for recurring schedules.

Console tracing:

- Set `TRACE_CONSOLE=true` to print `[scope] ...` traces for daemon, runner, tools, and adapters.

Assistant audio bridge (mobile POC audio streaming):

- Set `ASSISTANT_AUDIO_BRIDGE_ENABLED=true`.
- Set `ASSISTANT_AUDIO_BRIDGE_AGENT_ID=assistant_audio_bridge` (or another non-entrypoint agent id).
- Optional: tune OpenAI TTS with `ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_MODEL`, `ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_VOICE`, and `ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_INSTRUCTIONS`.
- Optional: enable Spotify pause/resume and music-control tools with `ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID`, `ASSISTANT_AUDIO_BRIDGE_SPOTIFY_TOKEN_FILE`, and `ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE`.
- If Spotify reports `redirect_uri: Not matching configuration`, set `ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI` and add the exact same URI in your Spotify app settings. Default is `http://127.0.0.1:43873/spotify/callback`.
- Optional: persist generated WAV files with `ASSISTANT_AUDIO_BRIDGE_AUDIO_ARTIFACT_DIR` (default `.data/assistant-audio-bridge/audio`).
- Optional: tune post-TTS resume timing with `ASSISTANT_AUDIO_BRIDGE_TTS_RESUME_PADDING_MS` (default `2000`).
- Optional: tune response retention with `ASSISTANT_AUDIO_BRIDGE_RESULT_TTL_MS` (default `600000`).
- Submit requests via `POST /adapters/assistant-audio-bridge/requests`.
- Poll request lifecycle via `GET /adapters/assistant-audio-bridge/requests/:requestId`.
- Stream generated assistant audio via `GET /adapters/assistant-audio-bridge/requests/:requestId/audio`.
- Acknowledge client playback completion via `POST /adapters/assistant-audio-bridge/requests/:requestId/playback-complete`.

## Runtime Endpoints
```bash
GET /health
GET /daemon
GET /agents
GET /agents/:agentId
POST /agents/runs
POST /agents/:agentId/runs
POST /triggers
POST /adapters/assistant-audio-bridge/requests
GET /adapters/assistant-audio-bridge/requests/:requestId
GET /adapters/assistant-audio-bridge/requests/:requestId/audio
POST /adapters/assistant-audio-bridge/requests/:requestId/playback-complete
```

Agent manifests live in `.pineapple/agents`. See `docs/agents.md` for the
manifest contract, direct agent routes, Telegram agent selection, and the
one-shot prompt template for creating a new specialist.

## Useful Commands
```bash
pnpm dev
pnpm dev:easy
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

 curl -X POST http://localhost:3000/adapters/assistant-audio-bridge/requests -H "content-type: application/json" -d "{\"text\":\"give me a short coaching tip for the next kilometer\"}"
