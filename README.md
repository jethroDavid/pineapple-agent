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

## Runtime Endpoints
```bash
GET /health
GET /daemon
POST /triggers
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
