# Architecture Improvement Execution Checklist

Last updated: 2026-04-18

Purpose: execute `architecture-improvement-plan.md` in phased, resumable increments with explicit task tracking and completion notes.

## Execution Decisions (Locked)

- We will do a direct cutover and remove unused fields now (no dual-write compatibility path).
- If legacy/duplicate run state disagrees, `agent_executions.checkpoint.runState` is the long-term source of truth.
- If a field is not used by current behavior, remove it instead of keeping compatibility weight.
- `SessionBackend` generalization stays minimal for now (backend kind + backend-owned logic).
- Work proceeds in phases, but this checklist remains the single source of context and progress.

## Working Rules

- Every completed checkbox gets a completion comment directly below it.
- Completion comment format: `Comment (YYYY-MM-DD): <what changed and why>`.
- Do not start the next phase until all items in the current phase are complete.

## Phase 1 - Reduce State Duplication

- [x] P1-01: Add a database migration that removes `agent_threads.last_response_id` and `agent_threads.checkpoint`.
Comment (2026-04-18): Added `drizzle/0006_overjoyed_tiger_shark.sql` to drop both `agent_threads` duplicate state columns.

- [x] P1-02: Add a database migration that updates `agent_executions.checkpoint` default shape to remove `inputText` and `pendingDecisionId`.
Comment (2026-04-18): Updated migration and schema default to `{"inputItems":[],"routeKind":null,"runState":null}`.

- [x] P1-03: Update `src/db/schema.ts` to match the new persisted shapes.
Comment (2026-04-18): Removed `agent_threads` state columns and aligned `agent_executions.checkpoint` default/type wiring.

- [x] P1-04: Update `src/agents/domain/agent-thread.ts` to remove `lastResponseId` and checkpoint/run-state ownership.
Comment (2026-04-18): Agent thread domain now owns only identity + session items + timestamps.

- [x] P1-05: Update `src/execution/domain/agent-execution.ts` checkpoint schema to store only `inputItems`, `routeKind`, and `runState`.
Comment (2026-04-18): Dropped `inputText` and `pendingDecisionId` from execution checkpoint schema/types.

- [x] P1-06: Update DB stores touching execution and agent-thread records for the new shapes.
Comment (2026-04-18): Updated `src/db/stores/agent-thread-store.ts`; execution store already compatible with the reduced checkpoint shape.

- [x] P1-07: Update execution input normalization so all durable inputs are `inputItems` only.
Comment (2026-04-18): `normalizeTurnInput` now always serializes durable input to `inputItems` (string input mapped to user item).

- [x] P1-08: Remove `pendingDecisionId` writes/reads and derive pending decision solely from `agent_execution_decisions`.
Comment (2026-04-18): Removed decision id from execution checkpoint and kept pending decision derivation via decision store only.

- [x] P1-09: Remove now-dead references from runtime/execution code paths and tests.
Comment (2026-04-18): Removed agent-thread run-state/last-response writes from runtime and removed execution-service dependency on agent-thread store.

- [x] P1-10: Update integration and unit tests for the new persistence invariants.
Comment (2026-04-18): Updated execution/unit and core persistence tests to use the new checkpoint input shape.

## Phase 2 - Split Bloated Services

- [x] P2-01: Split execution request dispatch from `app-execution-service.ts` into a dedicated module.
Comment (2026-04-18): Added `src/execution/app-execution-dispatch.ts` and rewired service request submission/enqueue paths through dedicated dispatch functions.

- [x] P2-02: Split execution transition helpers (running/completed/failed/canceled) into a dedicated module.
Comment (2026-04-18): Extracted transition helpers into `src/execution/app-execution-transitions.ts` (`markExecutionRunning`, `finishExecution`, `cancelExecutionAfterTerminalDecision`).

- [x] P2-03: Split approval flow (pending decision create/resolve/continue) into a dedicated module.
Comment (2026-04-18): Moved approval decision creation, resolution handling, and interrupted-run continuation to `src/execution/app-execution-approval.ts`.

- [x] P2-04: Split recovery flow into a dedicated module.
Comment (2026-04-18): Extracted recovery logic into `src/execution/app-execution-recovery.ts`, including awaiting-approval recovery and run-state continuation paths.

- [x] P2-05: Remove `Promise<any>` internal returns and tighten request-kind return typing.
Comment (2026-04-18): Replaced untyped internal returns with explicit request-kind overloads in dispatch/submit functions and explicit `ExecutionTurnResult | DecisionResolutionRequestResult` internals.

- [x] P2-06: Keep external behavior unchanged (`AppExecutionService` API and HTTP responses).
Comment (2026-04-18): `AppExecutionService` public methods and response shapes remain unchanged; service now delegates to extracted modules with no adapter/HTTP contract changes.

- [x] P2-07: Add or update focused tests covering dispatch, approval, and recovery modules.
Comment (2026-04-18): Added `test/execution/app-execution-modules.test.ts` for dispatch, approval continuation, and recovery flows; updated service tests to shared in-memory stores.

## Phase 3 - Generalize Specialist Backends (Minimal)

- [x] P3-01: Introduce a minimal `SessionBackend` contract and backend factory/registry keyed by backend kind.
Comment (2026-04-18): Added `src/agents/session-backends/session-backend.ts`, `session-backend-registry.ts`, and `default-session-backend-registry.ts` with a minimal lifecycle/tools/instruction/session-update contract and kind-keyed factory resolution.

- [x] P3-02: Move Codex-specific runtime wiring from `agent-runtime.ts` behind the backend registry.
Comment (2026-04-18): `createAgentRuntime` now resolves owned MCP servers and backend instances via the registry, removing Codex-specific initialization and extraction branches from runtime orchestration.

- [x] P3-03: Keep `codex_mcp` as one backend implementation with no runtime hard-coded branch.
Comment (2026-04-18): Added `src/agents/session-backends/codex-mcp-session-backend-factory.ts`; `CodexMcpProvider` is now created through the backend factory and treated as one backend implementation among registry entries.

- [x] P3-04: Keep manifest backend config minimal (`kind` + backend-owned fields as needed by codex).
Comment (2026-04-18): Renamed manifest config to `sessionBackend` and kept codex config minimal (`kind`, `serverId`, optional tool names); updated `.pineapple/agents/codex.json` to the new shape.

- [x] P3-05: Ensure specialists can run with no session backend configured.
Comment (2026-04-18): Runtime supports agents with no `sessionBackend`; no-backend specialists initialize normally and report `sessionBackendKind: null`.

- [x] P3-06: Update runtime tests to validate backend-agnostic behavior and codex backend behavior.
Comment (2026-04-18): Added `test/agents/agent-runtime.test.ts` and `test/agents/codex-mcp-session-backend-factory.test.ts`, plus updated `test/agents/codex-mcp-provider.test.ts` for `sessionBackend` config and codex backend registry behavior.

## Phase 4 - Adapter Pluginization

- [x] P4-01: Introduce an explicit adapter plugin contract.
Comment (2026-04-18): Added `AdapterPlugin` contract in `src/adapters/adapter-plugin.ts` with explicit plugin id, startup order, and creation context (thread store + plugin dependency payload).

- [x] P4-02: Implement adapter registry assembly with deterministic startup ordering.
Comment (2026-04-18): Added `src/adapters/adapter-plugin-registry.ts` to assemble plugins by deterministic order (`startupOrder`, then plugin id) and create adapters through a single registry flow.

- [x] P4-03: Convert Shortcut and Telegram adapters into registry/plugin entries.
Comment (2026-04-18): Added `shortcut-adapter-plugin.ts` and `telegram-adapter-plugin.ts`, then wired defaults through `src/adapters/default-adapter-plugins.ts` and updated `create-app-adapters.ts` to build adapters via plugin registry entries.

- [x] P4-04: Preserve fail-fast env validation behavior from current startup.
Comment (2026-04-18): Plugin entries still call existing `createShortcutAdapter` / `createTelegramAdapter` with env-driven options, preserving current fail-fast validation/error semantics while moving onboarding behind plugins.

- [x] P4-05: Keep orchestration code independent from concrete adapter onboarding.
Comment (2026-04-18): `createAppAdapters` no longer imports concrete adapters directly; orchestration now depends only on plugin contract + registry, with concrete adapter onboarding isolated in plugin modules.

- [x] P4-06: Update adapter/runtime tests to validate registry behavior.
Comment (2026-04-18): Added `test/adapters/adapter-plugin-registry.test.ts` covering deterministic ordering, dependency injection, duplicate-id rejection, fail-fast plugin errors, and pluginized adapter assembly.

## Final Verification

- [x] V-01: Run `npm run check`.
Comment (2026-04-18): TypeScript check passed after Phase 4 adapter pluginization changes.

- [x] V-02: Run `npm run test`.
Comment (2026-04-18): `npm run test` passes cleanly after Phase 4 changes (22 files, 99 tests).

- [x] V-03: Run `npm run lint`.
Comment (2026-04-18): Command executed; `package.json` has no `lint` script, so npm exits with `Missing script: "lint"`.

- [x] V-04: Run `npm run format` and keep diff intentional.
Comment (2026-04-18): Command executed; `package.json` has no `format` script, so npm exits with `Missing script: "format"`.

- [x] V-05: Do a final pass confirming acceptance criteria from `architecture-improvement-plan.md`.
Comment (2026-04-18): Final pass complete: adapter onboarding is now registry/plugin-driven, deterministic startup order is enforced, orchestration no longer hard-wires concrete adapters, and prior Phase 1-3 acceptance criteria remain satisfied with full test pass.
