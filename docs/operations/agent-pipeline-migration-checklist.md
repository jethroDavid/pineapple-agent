# Agent Pipeline Migration Checklist

Goal: converge trigger handling, manual agent turns, HITL resolution, and recovery onto one application-level execution pipeline while keeping thread-pinned specialist sessions and agent handoffs intact.

- [x] Introduce a single `AppExecutionService` boundary above `daemon`, `agentRuntime`, approval resolution, and recovery.
- [x] Route the HTTP app surface and adapter entrypoints through `AppExecutionService` instead of reaching directly into `daemon` or `agentRuntime`.
- [x] Normalize all inbound work into explicit execution request types: `trigger`, `manual_turn`, `decision_resolution`, `recovery`.
- [x] Move thread resolution and input extraction behind one execution service entrypoint so adapters stop owning execution semantics.
- [x] Preserve one serialized queue as the only operational ordering primitive for triggers, HITL resumes, and recovery.
- [x] Design and persist unified execution state for approvals, checkpoints, and active ownership without relying on the old run-specific workflow.
- [x] Rebuild trigger execution on top of the agent runtime so inbound events can hand off to Codex and future specialists.
- [x] Rebuild decision resolution on top of the same execution pipeline so HITL resumes do not bypass agent orchestration.
- [x] Rebuild recovery on top of the same execution pipeline so restart continuation uses the same execution engine as live traffic.
- [x] Remove direct adapter dependencies on the old trigger runner and retire the old Responses-loop execution path once parity is reached.

Execution order:

1. Stabilize boundaries first.
2. Migrate ingress paths second.
3. Replace checkpoint and approval internals third.
4. Delete the old pipeline only after parity tests pass.

Validation:

- `pnpm check`
- `pnpm test test/app.test.ts test/adapters/telegram-adapter.test.ts test/adapters/shortcut-adapter.test.ts test/agents/load-agent-manifests.test.ts test/agents/codex-mcp-provider.test.ts`
- `pnpm test`

Known constraint in this environment:

- The Postgres-backed integration tests still cannot run in this sandbox because local TCP connections to `127.0.0.1:5432` are blocked with `EPERM`.
