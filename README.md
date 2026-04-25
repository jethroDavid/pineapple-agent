# Pineapple Monorepo

Monorepo for Pineapple apps and shared packages.

Current workspaces:
- `apps/backend` - Node.js agent runtime and HTTP service
- `apps/mobile` - Expo React Native app for assistant audio streaming POC
- `packages/shared-contracts` - Shared API contracts and runtime schemas

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

## Useful Commands
```bash
pnpm dev
pnpm mobile:start
pnpm mobile:android
pnpm mobile:ios
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
