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
