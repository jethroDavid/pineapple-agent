# Future Extensibility Roadmap

Last updated: 2026-04-17

Purpose: capture deferred architecture work so it can be resumed later without re-analysis.

Status: superseded as the primary decision document by [architecture-improvement-plan.md](architecture-improvement-plan.md). Keep this file as supporting detail for the narrower extensibility work it originally captured.

## Context

Current implementation is intentionally small and explicit, but two extension seams are still hard-coded:

1. Session provider kind is currently only `codex_mcp`.
2. Adapter registration is static; adapters are wired in `createAppAdapters` instead of discovered as plugins.

## Item A: Multi-Provider Session Architecture

### Current State

- Session provider manifests only accept `kind: "codex_mcp"` in `src/agents/agent-manifest.ts`.
- Provider initialization logic in `src/agents/agent-runtime.ts` contains a direct conditional branch for `codex_mcp`.
- This supports one provider type well, but adding another provider kind requires touching core runtime branches.

### Target State

Introduce a provider registry/factory so new provider kinds can be added without changing core runtime orchestration.

### Proposed Direction

1. Create a `SessionProviderFactory` interface and a provider registry keyed by `kind`.
2. Move codex-specific creation into a `codex-mcp-provider-factory`.
3. Refactor runtime initialization to resolve providers via registry, not `if (kind === "codex_mcp")`.
4. Expand manifest schema to a discriminated union that can include additional provider kinds.
5. Add tests for:
   - unknown provider kind
   - missing referenced server
   - successful initialization for each registered kind

### Acceptance Criteria

- Adding a new session provider kind does not require editing `agent-runtime.ts` core decision branches.
- Provider-specific validation and tool creation live inside provider modules/factories.
- Existing `codex_mcp` behavior remains backward compatible.

## Item B: Plugin-Style Adapter Loader (Zero-Touch Onboarding)

### Current State

- Adapter construction is hard-wired in `src/adapters/create-app-adapters.ts`.
- New adapters require code edits in this factory and dependency wiring paths.
- Tool registration is already generic (`createAppToolRegistry`) but adapter discovery is not.

### Target State

Enable adapter onboarding by plugin registration metadata or module discovery, reducing core code edits.

### Proposed Direction

1. Define adapter plugin contract:
   - plugin id
   - optional env gating
   - dependency builder
   - adapter factory
2. Add an `AdapterPluginRegistry` that holds available plugins.
3. Convert existing Shortcut and Telegram adapters into plugin entries.
4. Update `createAppAdapters` to iterate registry entries and instantiate enabled adapters.
5. Keep strict startup error messages for partial/invalid config (same behavior as current code).

### Acceptance Criteria

- New adapter can be added by introducing a plugin module and registry entry, without editing orchestration code.
- Existing adapters still initialize identically under current environment variables.
- Tool registration continues to work without changes to `createAppToolRegistry`.

## Suggested Execution Order

1. Implement Item A first (session provider registry) because it unlocks additional specialist backends.
2. Implement Item B second (adapter plugin loader) to reduce integration friction as channels grow.

## Risks and Notes

- Plugin discovery should remain explicit enough to keep startup/debugging deterministic.
- Preserve current fail-fast validation for invalid env combinations.
- Avoid introducing dynamic loading patterns that make tests flaky or non-deterministic.

## Revisit Checklist

When this work is resumed:

1. Re-read:
   - `src/agents/agent-manifest.ts`
   - `src/agents/agent-runtime.ts`
   - `src/adapters/create-app-adapters.ts`
2. Confirm whether new provider kinds or new external channels are now required.
3. Choose incremental rollout (feature flags or phased migration) if production traffic depends on current paths.
