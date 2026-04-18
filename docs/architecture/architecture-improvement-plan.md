# Architecture Improvement Plan

Last updated: 2026-04-18

Purpose: consolidate the migration review, simplification tier list, and future extensibility direction into one decision document that can guide the next round of refactoring.

## Summary

The current migration achieved the right high-level outcome:

- one execution pipeline
- one serialized queue
- durable approval and recovery state
- thread-first execution
- multi-agent handoffs

The problem is not the direction. The problem is that too much responsibility has accumulated in a few places, and some extension seams are only partially generalized.

Today, `agent-runtime.ts`, `app-execution-service.ts`, and the Codex session integration carry too much orchestration detail. The system works, but the shape is bloated, harder to extend than it should be, and less elegant than the rest of the architecture wants to be.

## Current Review Position

These are the main conclusions from the review:

1. MCP should be extensible in the same way tools, adapters, and agents are extensible.
2. A specialist agent should not be defined by a Codex-specific session backend.
3. A specialist can be just another first-class agent, similar to `root_manager`, with its own tools, model, and handoffs.
4. Session-backed specialists should still exist, but only as an optional capability for agents that need durable external conversation state.
5. The architecture should not hard-code itself around `codex_mcp`.
6. `codex-mcp-provider`, `agent-runtime`, and `app-execution-service` currently own too many concerns and should be slimmed down.

## What Is Wrong Today

### 1. Specialist sessions are too Codex-specific

The manifest schema only allows `sessionProvider.kind = "codex_mcp"` in [src/agents/agent-manifest.ts](src/agents/agent-manifest.ts).

The runtime also contains direct Codex-specific branching in [src/agents/agent-runtime.ts](src/agents/agent-runtime.ts), where it:

- identifies the provider server
- excludes that server from generic MCP wiring
- constructs `CodexMcpProvider`
- initializes provider tools and instructions directly inside the core runtime

This means specialist-session extensibility is weaker than tool extensibility, adapter extensibility, and agent extensibility.

### 2. The design conflates "specialist agent" with "specialist session"

These are separate concepts:

- `agent`: a first-class unit in the handoff graph with instructions, tools, model, and handoffs
- `session backend`: an optional persistence/integration mechanism for agents that need an external ongoing session

Right now, the architecture trends toward treating a specialist as "an agent plus Codex session plumbing". That is too narrow.

The correct model is:

- every specialist is an agent
- some agents may also declare a session backend
- many specialists should not need a session backend at all

### 3. `agent-runtime.ts` is bloated

`agent-runtime.ts` currently does all of the following:

- loads manifests
- resolves models
- builds handoff graphs
- manages MCP server lifecycles
- decides which MCP servers are provider-owned
- initializes session providers
- composes provider instructions
- injects provider tools
- restores run state
- persists agent-thread state
- persists specialist session updates

That is too much for one module. It is functioning as:

- manifest loader
- agent graph builder
- MCP connection manager
- provider registry
- runtime executor
- post-run persistence coordinator

Those responsibilities should not live together long term.

### 4. `app-execution-service.ts` is bloated

`app-execution-service.ts` currently does all of the following:

- request dispatch for `trigger`, `manual_turn`, `decision_resolution`, and `recovery`
- routing
- input normalization
- execution record creation
- status transitions
- approval decision creation
- runtime invocation
- recovery continuation logic
- thread metadata updates
- execution failure handling

This is too much lifecycle logic in one file. The service boundary was the right move during migration, but the file is now carrying the entire execution state machine.

### 5. Execution state is more duplicated than necessary

The storage model is durable, but not minimal.

Current duplication examples:

- `agent_threads.lastResponseId` overlaps with `threads.lastResponseId`
- `agent_threads.checkpoint.runState` overlaps with `agent_executions.checkpoint.runState`
- `agent_executions.checkpoint.pendingDecisionId` duplicates what can already be derived from `agent_execution_decisions`
- `agent_executions.checkpoint` stores both `inputText` and `inputItems`, which increases branching for one conceptual input

Refs:

- [src/db/schema.ts](src/db/schema.ts)
- [src/agents/domain/agent-thread.ts](src/agents/domain/agent-thread.ts)
- [src/execution/domain/agent-execution.ts](src/execution/domain/agent-execution.ts)

### 6. Adapter extensibility is still static

Tools are already reasonably generic, but adapters are still hard-wired in [src/adapters/create-app-adapters.ts](src/adapters/create-app-adapters.ts).

That is acceptable for now, but it means adapter onboarding is still less extensible than it should be if more channels are added.

## Clarified Position On Codex And MCP

As of 2026-04-18, OpenAI's official docs still describe Codex running as an MCP server when used with the OpenAI Agents SDK:

- https://developers.openai.com/codex/guides/agents-sdk#running-codex-as-an-mcp-server

That matters because it means we should not make the opposite mistake either:

- do not assume "Codex replaces MCP"
- do not assume "Codex MCP is the permanent architecture"

The correct architectural conclusion is:

- Codex is one specialist backend option
- MCP is one transport/integration option
- neither should be the defining abstraction of the system

The system should be designed so that:

- a specialist can be a plain agent with normal tools
- a specialist can use Codex through MCP
- a specialist can use some future non-MCP backend

without changing core orchestration code.

## Target Architecture Direction

### Core Principle

Make agents first-class. Make session backends optional. Make transports replaceable.

### Desired Shape

1. `Agent`

- owns instructions
- owns toolsets
- owns handoffs
- owns model selection
- may optionally declare a session backend

2. `SessionBackend`

- optional extension used only by agents that need external durable conversation state
- responsible for provider-specific instructions
- responsible for provider-specific tool injection
- responsible for extracting provider session updates from output

3. `ExecutionEngine`

- owns queueing, execution lifecycle, approval pause/resume, and recovery
- should not know Codex-specific details
- should not know provider-specific details

4. `AdapterPlugin`

- owns inbound normalization only
- should not own orchestration semantics

### Important Separation

The system should model these independently:

- agent graph
- tool registry
- adapter registry
- session-backend registry
- execution state machine

If any one of those requires editing another one for a new implementation, the seam is still too weak.

## Refactoring Priorities

### S Tier: Simplify Now

These changes have the highest cleanup value with relatively low architectural risk.

1. Remove duplicated continuation state from `agent_threads`

- delete `agent_threads.checkpoint.runState`
- keep continuation state only in `agent_executions.checkpoint.runState`
- keep `agent_thread` focused on session items and active agent identity

2. Remove duplicated `lastResponseId` from `agent_threads`

- keep `threads.lastResponseId` as the source of truth

3. Shrink `agent_executions.checkpoint`

- remove `pendingDecisionId`
- strongly consider removing `routeKind` if it is only needed for response decoration

4. Normalize input to one durable shape

- store only `inputItems`
- stop storing both `inputText` and `inputItems`

5. Split `app-execution-service.ts`

- extract request dispatch
- extract execution transition helpers
- extract approval handling
- extract recovery handling

The goal is not more files for their own sake. The goal is to make the execution state machine legible.

### A Tier: Refactor Next

1. Introduce a session-backend registry/factory

- replace the hard-coded `codex_mcp` branch in `agent-runtime.ts`
- keep `codex_mcp` as one backend implementation, not the only shape

2. Redefine specialist sessions as optional agent capabilities

- every specialist remains a normal agent
- session-backed specialists opt in explicitly

3. Slim `agent-runtime.ts`

- move provider construction into backend factories
- move post-run session extraction into backend-owned handlers
- keep runtime focused on building agents and executing turns

4. Tighten return types in `app-execution-service.ts`

- remove `Promise<any>` internals
- use request-kind-specific return types

### B Tier: Improve When Needed

1. Convert adapters to a plugin registry

- keep startup deterministic
- preserve explicit env validation

2. Flatten bootstrap composition

- reduce the split across `createAppServices`, `createAppRuntime`, and app startup wiring

### C Tier: Defer

These are valid future concerns, but they should not distract from the cleanup work.

1. Dynamic plugin discovery

- explicit registries are safer than magic loading

2. Replacing the daemon implementation

- current serialized queue is simple and understandable
- queue replacement is lower value than removing duplicated state and over-coupling

## Proposed Execution Sequence

### Phase 1: Reduce State Duplication

Target:

- simplify persistence model without changing external behavior

Deliverables:

- remove duplicated `runState`
- remove duplicated `lastResponseId`
- reduce execution checkpoint fields
- normalize stored input representation

### Phase 2: Split Bloated Services

Target:

- make runtime and execution logic easier to reason about

Deliverables:

- split `app-execution-service.ts` into focused modules
- split provider-specific runtime logic out of `agent-runtime.ts`

### Phase 3: Generalize Specialist Backends

Target:

- make specialist session architecture as extensible as tools, adapters, and agents

Deliverables:

- `SessionBackendFactory`
- registry keyed by backend kind
- `codex_mcp` backend moved behind that registry
- manifest schema expanded to support multiple backend kinds

### Phase 4: Adapter Pluginization

Target:

- reduce core edits when onboarding new channels

Deliverables:

- adapter plugin contract
- adapter registry
- Shortcut and Telegram converted to plugin entries

## Proposed Acceptance Criteria

The cleanup is successful when the following are true:

1. Adding a new specialist backend does not require editing core runtime branches.
2. A specialist agent can exist without any session backend at all.
3. Codex support remains available, but is just one backend implementation.
4. `agent-runtime.ts` no longer owns provider-specific lifecycle wiring directly.
5. `app-execution-service.ts` no longer acts as the entire execution state machine in one file.
6. Durable state has one clear source of truth for continuation, response continuity, and pending approvals.
7. Adding a new adapter does not require editing orchestration code.

## Immediate Recommendation

Start with the S-tier cleanup before introducing any new abstraction.

Reason:

- the current code is bloated partly because it already has too much state and branching
- if we add a provider registry before reducing duplication, we will generalize complexity instead of removing it

The correct first step is:

1. simplify persisted state
2. split large orchestration files
3. then generalize the backend seams

## Scope Guardrails

To avoid turning cleanup into another bloated refactor, keep these guardrails:

1. Do not introduce abstractions unless there are already at least two plausible implementations.
2. Keep registries explicit, not magic.
3. Keep startup failure deterministic and fail-fast.
4. Preserve the current thread-first and queue-first model.
5. Prefer deleting duplicated state over wrapping it in more abstractions.

## Inputs Used For This Document

- migration review observations from this thread
- [agent-pipeline-migration-checklist.md](agent-pipeline-migration-checklist.md)
- [future-extensibility-roadmap.md](future-extensibility-roadmap.md)
- [src/agents/agent-manifest.ts](src/agents/agent-manifest.ts)
- [src/agents/agent-runtime.ts](src/agents/agent-runtime.ts)
- [src/execution/app-execution-service.ts](src/execution/app-execution-service.ts)
- [src/adapters/create-app-adapters.ts](src/adapters/create-app-adapters.ts)
- [src/db/schema.ts](src/db/schema.ts)
- OpenAI docs on Codex + Agents SDK: https://developers.openai.com/codex/guides/agents-sdk#running-codex-as-an-mcp-server
