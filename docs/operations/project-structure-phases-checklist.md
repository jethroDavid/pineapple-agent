# Project Structure Improvement Checklist

Last updated: 2026-04-18

Purpose: execute the repo cleanup/refactor in small, trackable phases.

## Working Rules

- Complete phases in order.
- Do not start the next phase until the current phase is done.
- Mark completed tasks with `[x]`.
- Add a short completion note under each finished phase.

## Phase 1 - Repo Hygiene

- [x] Create `docs/architecture`, `docs/learning`, and `docs/operations`.
- [x] Move root planning docs into the new `docs/` folders.
- [x] Keep only essential root files (README, package/config/runtime files).
- [x] Delete empty/stale paths:
  - [x] `.codex`
  - [x] `src/openai/`
  - [x] `test/openai/`
  - [x] `test/tools/`
- [x] Update README links after doc moves.
- [x] Run `pnpm check`.

Completion note:
- `Comment (2026-04-18): Created docs folders, moved root markdown planning docs into docs/, removed stale empty paths, updated README documentation links, and verified with pnpm check.`

## Phase 2 - Bootstrap/App Composition Reorg

- [x] Create `src/app/bootstrap/` and `src/app/http/`.
- [x] Move/refactor app bootstrap files:
  - [x] `src/app.ts` -> `src/app/http/app.ts`
  - [x] `src/app-runtime.ts` -> `src/app/bootstrap/app-runtime.ts`
  - [x] `src/app-services.ts` -> `src/app/bootstrap/app-services.ts`
  - [x] `src/app-error.ts` -> `src/app/http/app-error.ts`
- [x] Keep startup logic in bootstrap and route wiring in http modules.
- [x] Update imports/exports and keep behavior unchanged.
- [x] Run `pnpm check` and `pnpm test`.

Completion note:
- `Comment (2026-04-18): Moved app bootstrap modules into src/app/bootstrap and HTTP route modules into src/app/http, updated all import call sites, and verified behavior with pnpm check and pnpm test.`

## Phase 3 - Adapter Module Decomposition

- [x] Split `src/adapters/telegram/telegram-adapter.ts` into smaller modules.
- [x] Split `src/adapters/shortcut/shortcut-webhook.ts` into smaller modules.
- [x] Split `src/adapters/shortcut/shortcut-client.ts` into API/schema/helpers sections.
- [x] Create shared adapter helpers for duplicated logic (e.g., URL normalization).
- [x] Keep external adapter behavior and routes unchanged.
- [x] Run `pnpm check` and adapter-focused tests.

Completion note:
- `Comment (2026-04-18): Decomposed Telegram adapter into options and runtime modules, split Shortcut webhook handling into delivery/signature/trigger modules, split Shortcut client into API/schema/helper/workflow modules, introduced shared webhook URL helpers, and verified unchanged behavior with pnpm check and adapter-focused tests.`

## Phase 4 - Execution and Agent Runtime Boundaries

- [x] Group `app-execution-*` files under a clearer `execution/pipeline` structure.
- [x] Reduce responsibility in `src/agents/agent-runtime.ts` by extracting setup/build/run concerns.
- [x] Keep current runtime semantics and approval flow intact.
- [x] Run `pnpm check` and execution/agent test suites.

Completion note:
- `Comment (2026-04-18): Moved all app-execution modules into src/execution/pipeline, updated all source/test imports, extracted agent-runtime setup/build and turn execution into src/agents/runtime helper modules, and verified unchanged runtime/approval behavior with pnpm check plus execution/agent test runs.`

## Phase 5 - Test Structure Alignment

- [x] Reorganize `test/` to mirror `src/` module layout.
- [x] Split oversized tests (especially `test/app.test.ts`) into focused files.
- [x] Keep integration tests isolated from unit test helpers.
- [x] Ensure all test imports point to new paths.
- [x] Run full `pnpm test`.

Completion note:
- `Comment (2026-04-18): Reorganized tests to better mirror src (including execution/queue, execution/routing, core/contracts, core/domain, and core/tools), split monolithic test/app.test.ts into focused test/entrypoints/http suites with shared fixtures, preserved integration isolation under test/integration, updated all imports, and validated with full pnpm test.`

## Phase 6 - Core Decomposition

- [x] Move thread domain/store modules from `src/core` into `src/threads`.
- [x] Move trigger contracts from `src/core/contracts` into `src/execution/contracts`.
- [x] Move tool abstractions from `src/core/tools` into `src/tools`.
- [x] Move shared JSON types from `src/core/types` into `src/shared/types`.
- [x] Update all `src/` and `test/` imports to new paths.
- [x] Remove empty legacy `src/core` and `test/core` folders.
- [x] Run `pnpm check` and `pnpm test`.

Completion note:
- `Comment (2026-04-18): Removed src/core as a catch-all by relocating thread modules into src/threads, trigger contracts into src/execution/contracts, tool contracts into src/tools, and shared JSON types into src/shared/types; updated all source/test imports, migrated legacy test/core suites into domain-specific folders, and verified with pnpm check plus full pnpm test.`

## Phase 7 - Guardrails and Maintenance

- [ ] Add `lint` and `format` scripts in `package.json`.
- [ ] Add lightweight architecture boundary checks (import/path conventions).
- [ ] Add/enable unused export checks in CI workflow or local script.
- [ ] Update contributor guidance for the new structure.
- [ ] Run final `pnpm check` and `pnpm test`.

Completion note:
- `Comment (YYYY-MM-DD):`
