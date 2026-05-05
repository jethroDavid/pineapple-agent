# Pineapple Monorepo

Monorepo for Pineapple apps and shared packages.

Current workspaces:
- `apps/backend` - Node.js agent runtime and HTTP service
- `apps/web` - Static Pineapple Agent demo website for Firebase Hosting
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
pnpm pineapple
pnpm web:dev
pnpm web:build
pnpm mobile:start
pnpm mobile:android
pnpm mobile:ios
pnpm check
pnpm build
pnpm test
cd apps/backend EVAL_OPENAI_ENABLED=true pnpm exec vitest run test/evals/cron-trigger-routing.eval.test.ts
pnpm test:watch
pnpm db:up
pnpm db:down
pnpm db:status
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

## Mobile Build Guide

Track local changes before and after build steps:

```bash
git status --short
```

Development (no native rebuild, JS/TS changes only):

```bash
pnpm --filter mobile exec expo start --dev-client
```

Development rebuild (native changes):

```bash
pnpm --filter mobile exec expo prebuild --platform android --no-install
pnpm --filter mobile exec expo run:android --device
pnpm --filter mobile exec expo start --dev-client -c
```

Release build (Android):

```bash
cd apps/mobile/android
./gradlew.bat clean
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

See full details in `apps/mobile/README.md`.

## Website Deploy Guide

The Pineapple agent runs from the backend workspace:

```bash
pnpm pineapple
```

The website is only a static showcase. It builds into `apps/web/dist`, which is
the Firebase Hosting public directory in `firebase.json`.

```bash
pnpm web:build
firebase deploy --only hosting
```
