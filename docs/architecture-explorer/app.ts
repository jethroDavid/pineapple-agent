type LayerNode = {
  id: string;
  lane: string;
  kicker: string;
  title: string;
  summary: string;
  responsibilities: string[];
  details: string[];
  files: string[];
  dependencies: string[];
};

type ScenarioStep = {
  title: string;
  summary: string;
  whyItMatters: string;
  focusNodeIds?: string[];
  files: string[];
};

type Scenario = {
  id: string;
  title: string;
  kicker: string;
  summary: string;
  trigger: string;
  result: string;
  steps: ScenarioStep[];
};

type Concept = {
  id: string;
  title: string;
  summary: string;
  files: string[];
  sections: Array<{
    title: string;
    bullets: string[];
  }>;
};

type ExecutionState = {
  id: string;
  title: string;
  summary: string;
  notes: string[];
};

const heroMetrics = [
  {
    value: "2",
    label: "Current agents",
    copy: "The current manifests define one entry agent, `root_manager`, and one specialist, `codex`."
  },
  {
    value: "3",
    label: "Default adapters",
    copy: "Shortcut, cron, and Telegram are loaded through the adapter plugin registry when env config enables them."
  },
  {
    value: "5",
    label: "Durable record types",
    copy: "Threads, agent threads, specialist sessions, executions, and execution decisions form the durable core."
  },
  {
    value: "1",
    label: "Serialized queue",
    copy: "The daemon runs one job at a time so trigger handling, approvals, and recovery stay ordered."
  }
];

const layerNodes: LayerNode[] = [
  {
    id: "bootstrap",
    lane: "Startup And Composition",
    kicker: "Bootstrap",
    title: "App Startup",
    summary: "Builds the runtime, HTTP server, daemon lifecycle, adapter initialization, and recovery sequence.",
    responsibilities: [
      "Calls `createAppRuntime()` to build services, runtime, adapters, and daemon-aware execution service.",
      "Builds Fastify with core routes plus adapter routes.",
      "Ensures the database schema exists before accepting traffic.",
      "Starts the daemon before initialization work that needs queued execution.",
      "Initializes the agent runtime, then attempts active run recovery, then starts listening.",
      "Initializes adapters after the HTTP server is listening so webhook registration uses the live base URL."
    ],
    details: [
      "This is intentionally a thin composition layer. It decides startup order but does not own business rules.",
      "Failure handling is explicit: schema or runtime init failures exit the process, while recovery failures are logged and the app continues."
    ],
    files: [
      "src/index.ts",
      "src/entrypoints/bootstrap/runtime.ts",
      "src/entrypoints/bootstrap/services.ts"
    ],
    dependencies: ["http", "execution-service", "adapters", "agent-runtime"]
  },
  {
    id: "http",
    lane: "Startup And Composition",
    kicker: "Entrypoints",
    title: "Fastify HTTP Surface",
    summary: "Exposes health, daemon status, agent inspection, manual turns, trigger submission, and decision resolution.",
    responsibilities: [
      "Parses JSON while preserving the raw body buffer for webhook signature verification.",
      "Maps domain errors into HTTP-friendly responses through a centralized error mapper.",
      "Provides `GET /agents` for manifest inspection and `POST /agents/runs` for manual thread turns.",
      "Provides `POST /triggers` for normalized trigger events and `POST /decisions/:decisionId/resolve` for approval flow."
    ],
    details: [
      "The HTTP layer is intentionally dumb: it validates inputs with Zod, delegates to the execution service, and formats the result.",
      "Adapters extend the app by registering their own routes into the same Fastify instance."
    ],
    files: [
      "src/entrypoints/http/server.ts",
      "src/entrypoints/http/error-mapper.ts"
    ],
    dependencies: ["execution-service", "agent-runtime", "adapters"]
  },
  {
    id: "adapters",
    lane: "External Integration Layer",
    kicker: "Adapters",
    title: "App Adapters",
    summary: "Translate external systems and schedules into Pineapple trigger events and expose Pineapple tools back to those systems.",
    responsibilities: [
      "Each adapter implements `AppAdapter`: `getTools()`, `registerRoutes()`, and optional `initialize()`.",
      "Adapters can be inbound, outbound, or both. Telegram can listen to webhook or polling updates; Shortcut can receive signed webhooks; cron can originate system reminder triggers.",
      "Adapter plugins create adapters in a configured startup order and hide dependency wiring.",
      "Tools emitted by adapters become part of the global app toolset available to agents."
    ],
    details: [
      "Adapters are where system-specific concerns live: webhook secrets, message normalization, Shortcut filtering, Telegram thread selection, cron scheduling, and outbound API calls.",
      "This keeps the core execution pipeline agnostic to the source system."
    ],
    files: [
      "src/adapters/app-adapter.ts",
      "src/adapters/create-app-adapters.ts",
      "src/adapters/adapter-plugin-registry.ts",
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/shortcut/shortcut-adapter.ts",
      "src/adapters/telegram/telegram-adapter.ts"
    ],
    dependencies: ["tool-registry", "execution-service", "threads"]
  },
  {
    id: "cron",
    lane: "External Integration Layer",
    kicker: "Scheduling",
    title: "Cron Adapter And Scheduler",
    summary: "Adds scheduled system-originated work to Pineapple and also lets agents schedule reminders through a tool.",
    responsibilities: [
      "Initializes an in-process `CronScheduler` that manages configured jobs and future ticks.",
      "Converts scheduled jobs into `TriggerEvent`s with source `pineapple-cron` and event type `reminder.tick`.",
      "Exposes the `cron_schedule_reminder` tool so an agent can schedule one-shot or recurring follow-up work."
    ],
    details: [
      "Cron is architecturally interesting because it is both an adapter and a trigger source.",
      "Scheduled work still re-enters Pineapple as a normal trigger and therefore uses the same routing, execution, approval, and recovery machinery."
    ],
    files: [
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/cron/cron-scheduler.ts",
      "src/adapters/cron/cron-reminder.ts",
      "src/adapters/cron/cron-schedule-reminder-tool.ts"
    ],
    dependencies: ["execution-service", "tool-registry", "threads"]
  },
  {
    id: "tool-registry",
    lane: "External Integration Layer",
    kicker: "Tools",
    title: "Tool Registry And Toolsets",
    summary: "Collects adapter tools once and exposes them as named toolsets that agents can opt into.",
    responsibilities: [
      "Registers tool definitions with uniqueness enforced by tool name.",
      "Builds the `app` toolset from all adapter-exposed tools.",
      "Resolves toolset ids in agent manifests into concrete tool definitions.",
      "Converts each tool definition into an OpenAI Agents function tool, including approval requirements."
    ],
    details: [
      "A Pineapple tool has stronger metadata than a raw function: side effects, approval requirement, idempotency, and validated input/output schemas.",
      "Approval configuration flows all the way down into runtime interruptions.",
      "The app toolset now includes scheduling capability through `cron_schedule_reminder` in addition to transport tools."
    ],
    files: [
      "src/tools/tool-definition.ts",
      "src/tools/tool-registry.ts",
      "src/tools/create-app-tool-registry.ts",
      "src/agents/agent-toolset-registry.ts",
      "src/agents/runtime/agent-runtime-tool.ts",
      "src/adapters/cron/cron-schedule-reminder-tool.ts"
    ],
    dependencies: ["adapters", "agent-runtime"]
  },
  {
    id: "execution-service",
    lane: "Execution Core",
    kicker: "Orchestration",
    title: "Execution Service",
    summary: "Single facade for trigger submission, manual turns, decision resolution, and recovery.",
    responsibilities: [
      "Exposes a single API surface regardless of whether the caller came from HTTP or an adapter.",
      "Routes all work through the daemon so execution ordering is serialized.",
      "Converts high-level requests into dispatchable execution requests.",
      "Knows how to resume queued or running executions during startup recovery."
    ],
    details: [
      "This is the boundary between transport and orchestration.",
      "It does not contain the execution algorithm itself; that logic is split across `dispatch.ts`, `runtime.ts`, `approval.ts`, and `recovery.ts`."
    ],
    files: [
      "src/execution/pipeline/service.ts",
      "src/execution/pipeline/dispatch.ts",
      "src/execution/execution-contracts.ts"
    ],
    dependencies: ["daemon", "routing", "agent-runtime", "executions", "decisions", "threads"]
  },
  {
    id: "daemon",
    lane: "Execution Core",
    kicker: "Queue",
    title: "Pineapple Daemon",
    summary: "A minimal in-process serialized job queue that preserves ordering without external queue infrastructure.",
    responsibilities: [
      "Rejects submissions before startup so work cannot be queued against an uninitialized runtime.",
      "Processes exactly one job at a time through a single drain loop.",
      "Supports both awaited request/response jobs and detached fire-and-forget jobs.",
      "Tracks queue depth, processed count, and failed count for operational visibility."
    ],
    details: [
      "The queue is generic and intentionally tiny. Pineapple uses it for triggers, approvals, and recovery so all stateful execution changes stay ordered.",
      "This is the current substitute for a dedicated worker or distributed queue."
    ],
    files: [
      "src/execution/queue/pineapple-daemon.ts",
      "src/entrypoints/bootstrap/runtime.ts"
    ],
    dependencies: ["execution-service"]
  },
  {
    id: "routing",
    lane: "Execution Core",
    kicker: "Routing",
    title: "Trigger Routing",
    summary: "Turns a generic `TriggerEvent` into a specific thread choice: direct thread, subject match, subject create, or unbound create.",
    responsibilities: [
      "Accepts three routing modes: explicit `thread_id`, `(subject_type, subject_id)`, or `allow_unbound_thread=true`.",
      "Reopens closed subject-bound threads instead of silently creating duplicates.",
      "Raises explicit routing errors when a trigger cannot be mapped to a thread."
    ],
    details: [
      "This is one of the core thread-first ideas in Pineapple: external systems do not talk to agents directly, they route into a durable thread abstraction first.",
      "Subject routing is what lets repeated Shortcut or other business objects map back to the same conversation."
    ],
    files: [
      "src/execution/contracts/trigger-event.ts",
      "src/execution/routing/route-trigger-event.ts",
      "src/execution/routing/resolve-subject-thread.ts"
    ],
    dependencies: ["threads"]
  },
  {
    id: "prompt-enrichment",
    lane: "Execution Core",
    kicker: "Prompts",
    title: "Trigger Prompt Enrichment",
    summary: "After routing but before runtime execution, Pineapple can enrich a normalized trigger prompt with extra delivery or channel instructions.",
    responsibilities: [
      "Runs enrichers after thread routing so enrichers can use thread metadata.",
      "Currently enriches cron reminder prompts with Telegram delivery instructions when the thread has Telegram delivery context.",
      "Allows a trigger payload to override the entry agent through `agent_id`."
    ],
    details: [
      "This is a subtle but important evolution: prompt normalization is no longer a pure parse step, it is now a parse-plus-context-enrichment step.",
      "Because enrichment happens after routing, it can safely depend on thread metadata like delivery context."
    ],
    files: [
      "src/execution/contracts/trigger-prompt.ts",
      "src/execution/pipeline/dispatch.ts",
      "src/execution/pipeline/trigger-prompt-enrichment.ts"
    ],
    dependencies: ["routing", "threads", "agent-runtime"]
  },
  {
    id: "threads",
    lane: "Execution Core",
    kicker: "Thread Model",
    title: "Threads",
    summary: "The durable conversation anchor that everything else hangs off: routing, last response continuity, metadata, and closure/reopen behavior.",
    responsibilities: [
      "Stores user-facing title and description plus internal metadata such as `turnCount` and `provisionalTitle`.",
      "Tracks the latest `lastResponseId` so runtime continuity can extend the same conversation chain.",
      "Supports subject binding and reopen semantics.",
      "Acts as the foreign-key hub for agent threads, specialist sessions, executions, and decisions."
    ],
    details: [
      "A thread is not the same thing as the OpenAI session history. Pineapple separates business thread identity from runtime session storage.",
      "The execution pipeline increments `turnCount` only when a run completes rather than when it starts.",
      "Thread metadata now also stores delivery context such as Telegram chat identity, which later enrichers can use for proactive delivery."
    ],
    files: [
      "src/threads/domain/thread.ts",
      "src/threads/domain/thread-metadata.ts",
      "src/threads/store/thread-store.ts",
      "src/db/stores/thread-store.ts"
    ],
    dependencies: ["agent-runtime", "executions", "decisions", "persistence"]
  },
  {
    id: "agent-runtime",
    lane: "Agent Runtime Layer",
    kicker: "Runtime",
    title: "Agent Runtime",
    summary: "Loads manifests, builds the handoff graph, attaches tools and MCP servers, and executes turns through the OpenAI Agents runner.",
    responsibilities: [
      "Loads JSON manifests from `.pineapple/agents` and validates entrypoint uniqueness and handoff integrity.",
      "Builds each `Agent` instance recursively so handoffs become an explicit graph.",
      "Resolves model choice using either explicit model, `app` preset, or `codex` preset.",
      "Attaches local function tools and optional session-backend tools.",
      "Tracks `activeAgentId`, final output, run state, interruptions, and new items after each turn."
    ],
    details: [
      "The runtime is deliberately thin around the OpenAI Agents SDK. Pineapple keeps orchestration, persistence, approvals, and routing in app code.",
      "The current graph contains `root_manager` as entrypoint and `codex` as a handoff specialist."
    ],
    files: [
      "src/agents/agent-runtime.ts",
      "src/agents/load-agent-manifests.ts",
      "src/agents/runtime/agent-runtime-setup.ts",
      "src/agents/runtime/agent-runtime-turn.ts",
      ".pineapple/agents/root-manager.json",
      ".pineapple/agents/codex.json"
    ],
    dependencies: ["agent-threads", "specialist-sessions", "tool-registry", "threads"]
  },
  {
    id: "agent-threads",
    lane: "Agent Runtime Layer",
    kicker: "Session Memory",
    title: "Agent Threads",
    summary: "Persisted OpenAI session items plus the current active agent for each Pineapple thread.",
    responsibilities: [
      "Stores `sessionItems`, which are the turn history items the Runner session replays.",
      "Stores both `entrypointAgentId` and current `activeAgentId`.",
      "Backs a `PersistentAgentThreadSession` that implements the SDK session interface by reading and writing the DB-backed record."
    ],
    details: [
      "This is Pineapple's durable in-app conversation memory for the OpenAI runner.",
      "It is separate from `Thread` because business thread metadata and model session history evolve at different rates and for different reasons."
    ],
    files: [
      "src/agents/domain/agent-thread.ts",
      "src/agents/persistent-agent-thread-session.ts",
      "src/agents/store/agent-thread-store.ts",
      "src/db/stores/agent-thread-store.ts"
    ],
    dependencies: ["agent-runtime", "threads", "persistence"]
  },
  {
    id: "specialist-sessions",
    lane: "Agent Runtime Layer",
    kicker: "Provider Continuity",
    title: "Specialist Sessions",
    summary: "Per-thread, per-agent provider-side continuity state for specialists that need their own external session memory.",
    responsibilities: [
      "Stores provider-specific thread ids and JSON state outside the main OpenAI agent session.",
      "Lets a specialist like Codex reuse the same provider-side thread over multiple Pineapple turns.",
      "Injects extra instructions so the agent knows whether to continue or start a provider-side session."
    ],
    details: [
      "The current implementation is the `codex_mcp` session backend.",
      "This layer exists because some specialists are not just plain tools; they are long-lived external workspaces with their own continuity model."
    ],
    files: [
      "src/agents/domain/specialist-session.ts",
      "src/agents/session-backends/session-backend.ts",
      "src/agents/session-backends/codex-mcp-session-backend-factory.ts",
      "src/agents/providers/codex-mcp-provider.ts"
    ],
    dependencies: ["agent-runtime", "persistence"]
  },
  {
    id: "tracing",
    lane: "Durable State",
    kicker: "Observability",
    title: "Tracing Utility",
    summary: "A small console-tracing helper now annotates startup, execution, cron, and Telegram flows without introducing a larger observability framework.",
    responsibilities: [
      "Provides `trace()` and `traceError()` helpers with safe JSON serialization.",
      "Supports environment-based gating through `TRACE_CONSOLE` and development defaults.",
      "Gives architecture-critical flows a readable breadcrumb trail during local development."
    ],
    details: [
      "This is intentionally lightweight. Pineapple still avoids heavy infrastructure, but now exposes more of its control flow while developing or debugging.",
      "Tracing is now visible in startup, dispatch, cron firing, Telegram processing, and failure paths."
    ],
    files: [
      "src/utils/trace.ts",
      "src/index.ts",
      "src/execution/pipeline/dispatch.ts",
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/telegram/telegram-update-processor.ts"
    ],
    dependencies: ["bootstrap", "execution-service", "adapters"]
  },
  {
    id: "executions",
    lane: "Durable State",
    kicker: "Run Record",
    title: "Agent Executions",
    summary: "The durable record of a single run attempt, including checkpointed input, active agent, current status, and resumable run state.",
    responsibilities: [
      "Records the execution kind: trigger, manual turn, decision resolution, or recovery.",
      "Stores checkpoint input items, routing kind, and serialized run state.",
      "Tracks the current active agent and terminal error information.",
      "Enforces one active execution per thread at the database layer."
    ],
    details: [
      "This is the central operational record for app-like execution, not just a log table.",
      "Status transitions are explicit and mostly handled in `transitions.ts`."
    ],
    files: [
      "src/execution/domain/agent-execution.ts",
      "src/execution/pipeline/transitions.ts",
      "src/db/stores/agent-execution-store.ts"
    ],
    dependencies: ["threads", "decisions", "persistence"]
  },
  {
    id: "decisions",
    lane: "Durable State",
    kicker: "Human Gate",
    title: "Execution Decisions",
    summary: "Represents approval-required tool calls that pause execution until a human approves, rejects, or expiry is applied.",
    responsibilities: [
      "Created from runtime interruptions when a tool has `approvalRequired=true`.",
      "Stores requested action, raw tool arguments, originating agent id, and tool call identity.",
      "Allows resolution through the HTTP decision endpoint and restarts the serialized execution path.",
      "Enforces at most one pending decision per execution."
    ],
    details: [
      "Approval is not bolted on outside the runtime. Pineapple captures the serialized run state, stores a decision, and later rehydrates the run state with approval resolution applied.",
      "Rejected decisions cancel the execution; approved ones resume it."
    ],
    files: [
      "src/execution/domain/agent-execution-decision.ts",
      "src/execution/pipeline/approval.ts",
      "src/agents/restore-run-state.ts",
      "src/db/stores/agent-execution-decision-store.ts"
    ],
    dependencies: ["executions", "agent-runtime", "persistence"]
  },
  {
    id: "persistence",
    lane: "Durable State",
    kicker: "Database",
    title: "Postgres And Drizzle",
    summary: "The database schema is intentionally compact but carries most architectural invariants.",
    responsibilities: [
      "Defines the five core tables plus enum-backed status fields.",
      "Uses partial unique indexes to enforce only one active thread per subject, one active execution per thread, and one pending decision per execution.",
      "Keeps execution checkpoint, thread metadata, session items, and provider state as JSONB where shape flexibility is helpful."
    ],
    details: [
      "The codebase intentionally leans on the database for correctness so the app layer can stay relatively small.",
      "The architecture invariants test suite exercises exactly these guarantees."
    ],
    files: [
      "src/db/schema.ts",
      "test/integration/architecture-invariants.test.ts"
    ],
    dependencies: ["threads", "agent-threads", "specialist-sessions", "executions", "decisions"]
  }
];

const scenarios: Scenario[] = [
  {
    id: "startup",
    kicker: "Startup",
    title: "Cold Start To Ready State",
    summary: "How the process boots and reaches a state where it can accept work safely.",
    trigger: "Process start",
    result: "Fastify is listening, adapters are initialized, runtime is ready, and recoverable work has been replayed.",
    steps: [
      {
        title: "Compose runtime pieces",
        summary: "`createAppRuntime()` builds stores, adapters, tool registry, toolsets, agent runtime, daemon, and execution service.",
        whyItMatters: "The system is mostly wired through constructor-time dependency injection rather than a container.",
        focusNodeIds: ["bootstrap", "adapters", "tool-registry", "agent-runtime", "execution-service"],
        files: ["src/entrypoints/bootstrap/runtime.ts", "src/entrypoints/bootstrap/services.ts"]
      },
      {
        title: "Build Fastify surface",
        summary: "`buildApp()` registers core routes and gives each adapter a chance to attach its own transport-specific routes.",
        whyItMatters: "Adapters participate in transport setup without owning the whole server.",
        focusNodeIds: ["http", "adapters"],
        files: ["src/entrypoints/http/server.ts"]
      },
      {
        title: "Guard startup with schema readiness",
        summary: "If DB migrations have not been applied, the process logs the problem and exits immediately.",
        whyItMatters: "The app assumes durable state is available before it starts serving requests.",
        focusNodeIds: ["persistence"],
        files: ["src/index.ts", "src/db/client.ts"]
      },
      {
        title: "Start daemon and initialize runtime",
        summary: "The queue is started before agent runtime initialization and recovery. That lets recovery reuse the same serialized job path as live requests.",
        whyItMatters: "Recovery is not a separate code path with different concurrency semantics.",
        focusNodeIds: ["daemon", "agent-runtime", "execution-service"],
        files: ["src/index.ts", "src/execution/pipeline/service.ts"]
      },
      {
        title: "Recover active runs",
        summary: "Queued and running executions are re-submitted through the execution service so the checkpoint model decides whether to resume, re-run, or expose pending approval.",
        whyItMatters: "Crash recovery depends on persisted `AgentExecution` checkpoint state, not in-memory process state.",
        focusNodeIds: ["executions", "decisions", "agent-runtime"],
        files: ["src/index.ts", "src/execution/pipeline/recovery.ts"]
      },
      {
        title: "Trace the boot path",
        summary: "Startup now emits lightweight trace events for database readiness, runtime init, recovery counts, HTTP listen, and adapter initialization.",
        whyItMatters: "The architecture is easier to reason about when the boot sequence is visible in logs without adding a full tracing stack.",
        focusNodeIds: ["tracing", "bootstrap"],
        files: ["src/utils/trace.ts", "src/index.ts", "src/entrypoints/bootstrap/runtime.ts"]
      },
      {
        title: "Listen, then initialize adapters",
        summary: "After the server is live, adapters reconcile webhook registrations, bot commands, polling, and other external integration state.",
        whyItMatters: "External systems should only be pointed at a process that can actually receive traffic.",
        focusNodeIds: ["adapters", "http"],
        files: ["src/index.ts", "src/adapters/telegram/telegram-adapter-handling.ts", "src/adapters/shortcut/shortcut-adapter.ts"]
      }
    ]
  },
  {
    id: "manual-turn",
    kicker: "Manual",
    title: "Manual Agent Turn",
    summary: "What happens when a caller explicitly asks the app to run a turn with `POST /agents/runs`.",
    trigger: "HTTP `POST /agents/runs`",
    result: "A thread turn is executed immediately through the serialized queue and returns a structured execution result.",
    steps: [
      {
        title: "Validate request and delegate",
        summary: "The HTTP route parses `agent_id`, optional `thread_id`, and input text, then calls `execution.runTurn()`.",
        whyItMatters: "Manual turns use the same orchestration core as webhook triggers, just with a simpler entry contract.",
        focusNodeIds: ["http", "execution-service"],
        files: ["src/entrypoints/http/server.ts", "src/execution/pipeline/service.ts"]
      },
      {
        title: "Queue the request",
        summary: "`submitExecutionRequest()` sends the work through the daemon, even though the caller awaits the result.",
        whyItMatters: "Ordering guarantees stay uniform whether the caller is synchronous or asynchronous.",
        focusNodeIds: ["daemon", "execution-service"],
        files: ["src/execution/pipeline/dispatch.ts", "src/execution/queue/pineapple-daemon.ts"]
      },
      {
        title: "Resolve thread and create execution",
        summary: "A missing `thread_id` creates a new thread; an existing one is loaded; missing threads fail fast. Then an `AgentExecution` row is inserted with checkpoint input and requested agent.",
        whyItMatters: "The execution record exists before model work begins, so there is always a durable run anchor.",
        focusNodeIds: ["threads", "executions"],
        files: ["src/execution/pipeline/dispatch.ts", "src/execution/domain/agent-execution.ts"]
      },
      {
        title: "Mark running and execute runtime turn",
        summary: "The execution status flips from `queued` to `running`, then `agentRuntime.executeTurn()` runs against the thread and current agent graph.",
        whyItMatters: "The runtime does not invent state; it consumes checkpointed input from the execution record.",
        focusNodeIds: ["executions", "agent-runtime", "agent-threads"],
        files: ["src/execution/pipeline/runtime.ts", "src/agents/runtime/agent-runtime-turn.ts"]
      },
      {
        title: "Persist results and thread continuity",
        summary: "If no approval is needed, Pineapple stores the new `lastResponseId`, increments thread `turnCount`, and returns final output. If approval is needed, it stores a pending decision instead.",
        whyItMatters: "Thread metadata and approval state are updated as part of the same orchestration flow.",
        focusNodeIds: ["threads", "decisions", "executions"],
        files: ["src/execution/pipeline/runtime.ts", "src/execution/pipeline/shared.ts"]
      }
    ]
  },
  {
    id: "trigger",
    kicker: "Webhook",
    title: "Inbound Trigger Flow",
    summary: "How external systems such as Shortcut or Telegram enter the app and become durable agent work.",
    trigger: "Adapter webhook or polling update",
    result: "The external event becomes a normalized `TriggerEvent`, is routed to a thread, and runs through the exact same execution machinery as a manual turn.",
    steps: [
      {
        title: "Adapter verifies and normalizes inbound data",
        summary: "Shortcut verifies HMAC signatures and filters self-authored comments; Telegram validates secret headers, commands, and message shape.",
        whyItMatters: "Integration-specific trust and filtering decisions stay at the edge instead of leaking into the core.",
        focusNodeIds: ["adapters"],
        files: ["src/adapters/shortcut/shortcut-adapter.ts", "src/adapters/telegram/telegram-adapter-handling.ts", "src/adapters/telegram/telegram-update-processor.ts"]
      },
      {
        title: "Adapter creates a `TriggerEvent`",
        summary: "The inbound event is turned into a stable envelope containing source, actor, routing, payload, and received time.",
        whyItMatters: "The rest of Pineapple does not care whether the event came from Telegram, Shortcut, CLI, or some future system.",
        focusNodeIds: ["routing", "adapters"],
        files: ["src/execution/contracts/trigger-event.ts", "src/adapters/shortcut/shortcut-webhook.ts", "src/adapters/telegram/telegram-webhook.ts"]
      },
      {
        title: "The daemon serializes the trigger",
        summary: "Adapters call `enqueueTrigger()` so background webhook work enters the same single-job queue as everything else.",
        whyItMatters: "Ordering across webhook deliveries and other execution mutations is preserved.",
        focusNodeIds: ["daemon", "execution-service"],
        files: ["src/execution/pipeline/service.ts", "src/execution/queue/pineapple-daemon.ts"]
      },
      {
        title: "Trigger routing chooses the thread",
        summary: "The routing layer binds the trigger to an existing thread, a subject-matched thread, a newly created subject thread, or a new unbound thread.",
        whyItMatters: "Thread identity is chosen before any agent call, which is the core thread-first design choice.",
        focusNodeIds: ["routing", "threads"],
        files: ["src/execution/routing/route-trigger-event.ts", "src/execution/routing/resolve-subject-thread.ts"]
      },
      {
        title: "Execution record captures checkpointed prompt",
        summary: "The trigger payload is parsed as a `TriggerPrompt`, normalized into OpenAI agent input items, and stored in the execution checkpoint before runtime work begins.",
        whyItMatters: "Crash recovery can replay from a durable prompt representation rather than from adapter-specific payloads.",
        focusNodeIds: ["executions", "routing"],
        files: ["src/execution/contracts/trigger-prompt.ts", "src/execution/pipeline/dispatch.ts", "src/execution/pipeline/shared.ts"]
      },
      {
        title: "Runtime turn and adapter-aware reply behavior",
        summary: "The runtime executes the turn. Telegram may send a fallback plain-text reply only if the agent did not already call `telegram_send_message`.",
        whyItMatters: "Adapters can provide both tools and post-run delivery behavior without invading core runtime logic.",
        focusNodeIds: ["agent-runtime", "adapters", "tool-registry"],
        files: ["src/agents/runtime/agent-runtime-turn.ts", "src/adapters/telegram/telegram-update-processor.ts"]
      }
    ]
  },
  {
    id: "cron",
    kicker: "Scheduled",
    title: "Cron Reminder Flow",
    summary: "How Pineapple now creates system-originated reminder work either from configured jobs or from an agent-scheduled reminder.",
    trigger: "Cron tick or `cron_schedule_reminder` output",
    result: "A scheduled reminder becomes a normal trigger, then routes into a thread and can deliver proactively through the correct channel.",
    steps: [
      {
        title: "A job exists in the scheduler",
        summary: "Jobs come either from `CRON_JOBS_JSON` at startup or from the `cron_schedule_reminder` tool during a live agent turn.",
        whyItMatters: "Scheduling is no longer only a deployment concern. Agents can create future work themselves.",
        focusNodeIds: ["cron", "tool-registry"],
        files: ["src/adapters/cron/cron-adapter.ts", "src/adapters/cron/cron-schedule-reminder-tool.ts"]
      },
      {
        title: "Cron fires a system trigger",
        summary: "The scheduler converts the job into a `TriggerEvent` with source system `pineapple-cron` and event type `reminder.tick`.",
        whyItMatters: "Scheduled work re-enters Pineapple through the exact same trigger contract as any other source.",
        focusNodeIds: ["cron", "routing"],
        files: ["src/adapters/cron/cron-reminder.ts", "src/execution/contracts/trigger-event.ts"]
      },
      {
        title: "Routing chooses the target thread",
        summary: "A cron reminder can target an explicit thread, a subject-bound thread, or an unbound thread depending on its routing metadata.",
        whyItMatters: "Even scheduled work stays thread-first instead of bypassing the conversation model.",
        focusNodeIds: ["threads", "routing"],
        files: ["src/adapters/cron/cron-reminder.ts", "src/execution/routing/route-trigger-event.ts"]
      },
      {
        title: "Prompt enrichment injects delivery context",
        summary: "If the thread metadata contains Telegram delivery context, Pineapple appends channel-specific instructions before runtime execution.",
        whyItMatters: "The reminder can be delivered proactively without re-asking for chat identity.",
        focusNodeIds: ["prompt-enrichment", "threads"],
        files: ["src/execution/pipeline/trigger-prompt-enrichment.ts", "src/threads/domain/thread-metadata.ts"]
      },
      {
        title: "The reminder runs as a normal execution",
        summary: "From this point forward the cron reminder is just a trigger-backed execution and can use normal tools, approvals, and thread continuity.",
        whyItMatters: "Pineapple avoided inventing a second execution engine for scheduled work.",
        focusNodeIds: ["execution-service", "executions", "agent-runtime"],
        files: ["src/execution/pipeline/dispatch.ts", "src/execution/pipeline/runtime.ts"]
      }
    ]
  },
  {
    id: "approval",
    kicker: "Human In Loop",
    title: "Approval Pause And Resume",
    summary: "How approval-required tools become durable pending decisions and then resume later from serialized run state.",
    trigger: "Runtime interruption on a tool marked `approvalRequired`",
    result: "The execution either resumes from the saved checkpoint after approval or is canceled after rejection/expiry.",
    steps: [
      {
        title: "Tool metadata marks approval requirement",
        summary: "Tool definitions carry `approvalRequired`, and `toAgentFunctionTool()` maps that to OpenAI Agents `needsApproval`.",
        whyItMatters: "Approval is a tool capability, not a route-specific hack.",
        focusNodeIds: ["tool-registry"],
        files: ["src/tools/tool-definition.ts", "src/agents/runtime/agent-runtime-tool.ts"]
      },
      {
        title: "Runtime returns interruption plus serialized state",
        summary: "When the model reaches an approval-required tool call, the Runner returns interruptions and `result.state.toString()` gives the resumable run state.",
        whyItMatters: "Pineapple can pause precisely at the tool boundary rather than approximating a resume point.",
        focusNodeIds: ["agent-runtime", "executions"],
        files: ["src/agents/runtime/agent-runtime-turn.ts", "src/execution/pipeline/runtime.ts"]
      },
      {
        title: "Pending decision is persisted",
        summary: "The first interruption becomes an `AgentExecutionDecision` containing tool identity, arguments, requested action, and active agent id.",
        whyItMatters: "Humans approve a durable decision record, not an in-memory callback.",
        focusNodeIds: ["decisions", "executions"],
        files: ["src/execution/pipeline/approval.ts", "src/execution/domain/agent-execution-decision.ts"]
      },
      {
        title: "Execution remains suspended with checkpoint state",
        summary: "The execution status changes to `awaiting_approval` and keeps its serialized `runState` in the checkpoint.",
        whyItMatters: "The run can survive process death or delayed review without losing the exact interrupt context.",
        focusNodeIds: ["executions", "decisions"],
        files: ["src/execution/pipeline/runtime.ts", "src/execution/pipeline/transitions.ts"]
      },
      {
        title: "Resolution endpoint restarts serialized execution",
        summary: "A human resolves the decision through the HTTP endpoint, which updates the decision and, for approval, calls `continueInterruptedExecution()`.",
        whyItMatters: "Resumption reuses the same queue and runtime path as normal execution, which reduces hidden branching logic.",
        focusNodeIds: ["http", "execution-service", "daemon"],
        files: ["src/entrypoints/http/server.ts", "src/execution/pipeline/approval.ts"]
      },
      {
        title: "Run state is rehydrated and approved or rejected in-place",
        summary: "`restoreRunState()` rebuilds the runner state, finds the exact tool interruption by `toolCallId` and `toolName`, then approves or rejects it before execution continues.",
        whyItMatters: "Approval continuity is exact, not best-effort.",
        focusNodeIds: ["decisions", "agent-runtime"],
        files: ["src/agents/restore-run-state.ts", "src/execution/pipeline/runtime.ts"]
      }
    ]
  },
  {
    id: "recovery",
    kicker: "Crash Recovery",
    title: "Recovery After Restart",
    summary: "How Pineapple reconstructs in-flight work after a restart without extra orchestration infrastructure.",
    trigger: "Process startup with executions still in `queued` or `running`",
    result: "Each recoverable execution becomes either a resumed run, a fresh replay from input, or a surfaced awaiting-approval result.",
    steps: [
      {
        title: "List recoverable executions",
        summary: "The execution service fetches every execution still marked `queued` or `running` and re-submits a recovery request for each one.",
        whyItMatters: "Recovery logic starts from durable execution status, not from runtime memory that no longer exists.",
        focusNodeIds: ["executions", "execution-service"],
        files: ["src/execution/pipeline/service.ts"]
      },
      {
        title: "Load thread and inspect checkpoint",
        summary: "Recovery loads the owning thread and branches based on execution status plus whether a checkpointed `runState` exists.",
        whyItMatters: "Pineapple has three recovery modes because not every interrupted run stopped at the same stage.",
        focusNodeIds: ["threads", "executions"],
        files: ["src/execution/pipeline/recovery.ts"]
      },
      {
        title: "Awaiting approval returns immediately",
        summary: "If the execution was already awaiting approval, recovery simply surfaces the existing pending decision instead of re-running anything.",
        whyItMatters: "Human review state is treated as terminal pending work, not a runtime failure.",
        focusNodeIds: ["decisions", "executions"],
        files: ["src/execution/pipeline/recovery.ts", "src/db/stores/agent-execution-decision-store.ts"]
      },
      {
        title: "Serialized state resumes interrupted runs",
        summary: "If a saved `runState` exists, recovery continues the interrupted runtime from that serialized state.",
        whyItMatters: "This preserves tool-approval or handoff context inside the model runner.",
        focusNodeIds: ["agent-runtime", "executions"],
        files: ["src/execution/pipeline/recovery.ts", "src/execution/pipeline/approval.ts", "src/agents/restore-run-state.ts"]
      },
      {
        title: "Fresh replay falls back to stored input",
        summary: "If there is no run state, Pineapple runs a fresh execution using the checkpointed input items and remembered route kind.",
        whyItMatters: "Even pre-interruption work can recover because the original runnable input was persisted with the execution.",
        focusNodeIds: ["executions", "routing", "agent-runtime"],
        files: ["src/execution/pipeline/runtime.ts", "src/execution/pipeline/shared.ts"]
      }
    ]
  }
];

const concepts: Concept[] = [
  {
    id: "app-runtime",
    title: "App Runtime",
    summary: "The app runtime is the assembled operating envelope of Pineapple: adapters, daemon, execution service, agent runtime, startup order, and shutdown behavior.",
    files: [
      "src/index.ts",
      "src/entrypoints/bootstrap/runtime.ts",
      "src/entrypoints/bootstrap/services.ts"
    ],
    sections: [
      {
        title: "What it owns",
        bullets: [
          "Dependency composition for the whole service.",
          "Lifecycle boundaries such as initialize, close, and recovery startup steps.",
          "Feature gating: if `OPENAI_API_KEY` or `OPENAI_MODEL` are missing, the richer runtime is not created."
        ]
      },
      {
        title: "Why it matters",
        bullets: [
          "It keeps `index.ts` extremely small while still making startup order explicit.",
          "It is also where Pineapple decides whether it can operate in full agent mode or must stay effectively disabled."
        ]
      },
      {
        title: "Design takeaway",
        bullets: [
          "This app runtime is deliberately operational, not domain-heavy. It is a composition root, not an orchestration brain."
        ]
      }
    ]
  },
  {
    id: "agent-execution",
    title: "Agent Execution",
    summary: "An `AgentExecution` is Pineapple's durable run record and the best way to understand app-like execution in this repo.",
    files: [
      "src/execution/domain/agent-execution.ts",
      "src/execution/pipeline/runtime.ts",
      "src/execution/pipeline/transitions.ts"
    ],
    sections: [
      {
        title: "Core fields",
        bullets: [
          "`kind` tells you why the run exists: trigger, manual turn, decision resolution, or recovery.",
          "`entrypointAgentId`, `requestedAgentId`, and `activeAgentId` separate who started the run from who is currently working.",
          "`checkpoint` stores the durable runnable payload: `inputItems`, `routeKind`, and optional `runState`."
        ]
      },
      {
        title: "Why the checkpoint exists",
        bullets: [
          "Without checkpointed input, recovery would need to reconstruct prompts from external systems, which would be brittle.",
          "Without serialized `runState`, Pineapple could not resume approval pauses precisely."
        ]
      },
      {
        title: "Status model",
        bullets: [
          "`queued` means accepted but not running yet.",
          "`running` means the serialized queue has started processing it.",
          "`awaiting_approval` means the runtime paused on an approval-required tool call.",
          "`completed`, `failed`, and `canceled` are terminal."
        ]
      }
    ]
  },
  {
    id: "threads-model",
    title: "Threads",
    summary: "The thread is the primary durable subject of the whole app. Most other tables are execution or runtime views of work happening on top of a thread.",
    files: [
      "src/threads/domain/thread.ts",
      "src/execution/routing/route-trigger-event.ts",
      "src/db/schema.ts"
    ],
    sections: [
      {
        title: "Thread-first means",
        bullets: [
          "Routing chooses a thread before agent execution begins.",
          "External systems are normalized into thread work rather than calling an agent directly.",
          "Conversation continuity is attached to thread identity, not just to the current network request."
        ]
      },
      {
        title: "Business identity vs runtime memory",
        bullets: [
          "The thread stores business-facing fields like title, description, subject binding, and metadata.",
          "Runtime chat history is kept separately in `agent_threads`, which lets Pineapple evolve each layer independently.",
          "Delivery context like Telegram chat identity now lives in thread metadata so non-Telegram sources such as cron can still deliver back into the right channel."
        ]
      },
      {
        title: "Subtle detail",
        bullets: [
          "`lastResponseId` is written back only on successful non-paused completions. That preserves response continuity between turns without pretending a paused or failed run advanced the conversation."
        ]
      }
    ]
  },
  {
    id: "agents",
    title: "Agents And Handoffs",
    summary: "The agent layer is manifest-driven. JSON manifests define the graph, prompts, toolsets, models, and optional session backend.",
    files: [
      ".pineapple/agents/root-manager.json",
      ".pineapple/agents/codex.json",
      "src/agents/load-agent-manifests.ts",
      "src/agents/runtime/agent-runtime-setup.ts"
    ],
    sections: [
      {
        title: "Current graph",
        bullets: [
          "`root_manager` is the single entrypoint and owns task routing.",
          "`codex` is the coding specialist and is reachable through a handoff.",
          "Both use the shared `app` toolset, but only `codex` has a `codex_mcp` session backend."
        ]
      },
      {
        title: "Initialization rules",
        bullets: [
          "Manifest ids must be unique.",
          "Exactly one manifest must declare `entrypoint=true`.",
          "Every declared handoff must reference an existing manifest.",
          "Cycles in the actual built handoff graph are rejected during recursive build."
        ]
      },
      {
        title: "Architectural meaning",
        bullets: [
          "Pineapple is not hard-coded to two agents. The manifest system is the extension mechanism for adding specialists without rebuilding the orchestration core."
        ]
      }
    ]
  },
  {
    id: "agent-thread",
    title: "Agent Thread",
    summary: "The `agent_threads` record is the OpenAI Runner session view of a Pineapple thread.",
    files: [
      "src/agents/domain/agent-thread.ts",
      "src/agents/persistent-agent-thread-session.ts",
      "src/agents/runtime/agent-runtime-turn.ts"
    ],
    sections: [
      {
        title: "Why it exists separately",
        bullets: [
          "The OpenAI Runner needs a session object that can read and write conversation items.",
          "The app thread itself should not be forced to carry raw model session items."
        ]
      },
      {
        title: "Important behavior",
        bullets: [
          "If the thread has never run before, Pineapple creates its `agent_thread` lazily on first runtime execution.",
          "The active agent id is updated after each run so future continuations resume from the correct specialist when needed."
        ]
      },
      {
        title: "Practical outcome",
        bullets: [
          "A thread can have business continuity, OpenAI session continuity, and specialist-provider continuity all at once, but each is stored in the right place."
        ]
      }
    ]
  },
  {
    id: "specialist-session",
    title: "Specialist Session",
    summary: "Specialist sessions capture continuity for provider-backed specialists whose own external tools have a concept of threads or workspaces.",
    files: [
      "src/agents/domain/specialist-session.ts",
      "src/agents/providers/codex-mcp-provider.ts",
      "src/agents/session-backends/session-backend.ts"
    ],
    sections: [
      {
        title: "Current implementation",
        bullets: [
          "The `codex_mcp` backend connects to an MCP server, exposes its start and reply tools, and extracts returned `threadId` data from function outputs.",
          "That provider-side `threadId` is stored as a `SpecialistSession` for the Pineapple thread and agent."
        ]
      },
      {
        title: "Why it matters",
        bullets: [
          "Without this layer, the Codex specialist would lose its own thread continuity even if the main Pineapple thread persisted correctly.",
          "The provider state is JSON so the backend can evolve without forcing a rigid relational schema."
        ]
      },
      {
        title: "Instruction injection",
        bullets: [
          "The session backend can add instructions telling the agent whether to continue an existing provider thread or start a new one."
        ]
      }
    ]
  },
  {
    id: "adapter",
    title: "Adapter",
    summary: "Adapters are Pineapple's ports-and-adapters layer: all external system behavior and scheduling edges live here, while core execution stays generic.",
    files: [
      "src/adapters/app-adapter.ts",
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/shortcut/shortcut-adapter.ts",
      "src/adapters/telegram/telegram-adapter.ts",
      "src/adapters/telegram/telegram-update-processor.ts"
    ],
    sections: [
      {
        title: "Inbound role",
        bullets: [
          "Receive, verify, normalize, and filter external events.",
          "Decide what raw external data should become Pineapple input.",
          "Choose whether background fire-and-forget processing or direct request/response behavior is appropriate."
        ]
      },
      {
        title: "Outbound role",
        bullets: [
          "Expose effectful tools like Telegram send-message or Shortcut story/comment operations.",
          "Optionally perform fallback delivery behavior after a run if the model did not call the dedicated outbound tool.",
          "Cron is a special adapter because it also originates work by firing scheduled triggers."
        ]
      },
      {
        title: "Good architectural boundary",
        bullets: [
          "The core never has to know how Telegram commands work or how Shortcut signs webhook payloads. That is exactly the separation adapters are providing."
        ]
      }
    ]
  },
  {
    id: "tooling",
    title: "Tool Definitions",
    summary: "Tools in Pineapple are typed, approval-aware contracts rather than raw callback functions.",
    files: [
      "src/tools/tool-definition.ts",
      "src/agents/runtime/agent-runtime-tool.ts",
      "src/tools/tool-registry.ts"
    ],
    sections: [
      {
        title: "Fields that matter",
        bullets: [
          "Input and output schemas let the tool validate what the model sends and returns.",
          "`sideEffecting`, `approvalRequired`, and `idempotent` capture operational intent.",
          "The tool registry enforces uniqueness by name across the whole app."
        ]
      },
      {
        title: "Why this is stronger than a plain function",
        bullets: [
          "The same definition powers model-visible description, runtime validation, approval interruptions, and future policy decisions."
        ]
      }
    ]
  },
  {
    id: "cron-scheduler",
    title: "Cron Scheduler",
    summary: "The cron subsystem adds first-class scheduled work, one-shot reminders, and natural-language reminder parsing to Pineapple.",
    files: [
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/cron/cron-scheduler.ts",
      "src/adapters/cron/cron-reminder.ts",
      "src/adapters/cron/cron-schedule-reminder-tool.ts"
    ],
    sections: [
      {
        title: "What it does",
        bullets: [
          "Maintains in-process scheduled jobs with next-run timestamps.",
          "Supports configured jobs plus agent-created reminder jobs.",
          "Converts schedule ticks into ordinary `TriggerEvent`s."
        ]
      },
      {
        title: "Why it matters",
        bullets: [
          "It extends Pineapple from reactive webhook handling into proactive system behavior.",
          "It does this without creating a separate workflow engine."
        ]
      },
      {
        title: "Interesting detail",
        bullets: [
          "The reminder tool accepts both cron expressions and phrases like 'in 15 seconds' or 'every 5 minutes'."
        ]
      }
    ]
  },
  {
    id: "prompt-enrichment",
    title: "Trigger Prompt Enrichment",
    summary: "Prompt enrichment is the step between parsing a trigger payload and handing runnable input to the agent runtime.",
    files: [
      "src/execution/contracts/trigger-prompt.ts",
      "src/execution/pipeline/dispatch.ts",
      "src/execution/pipeline/trigger-prompt-enrichment.ts"
    ],
    sections: [
      {
        title: "What changed",
        bullets: [
          "Triggers can now carry `agent_id` to select an entry agent explicitly.",
          "Parsed trigger prompts can be enriched with context-aware instructions after routing."
        ]
      },
      {
        title: "Current use",
        bullets: [
          "Cron reminder prompts are enriched with Telegram delivery instructions when the thread already knows the target chat."
        ]
      },
      {
        title: "Architectural payoff",
        bullets: [
          "Input normalization is now a deliberate stage in the pipeline, not just a parse helper."
        ]
      }
    ]
  },
  {
    id: "tracing",
    title: "Tracing And Diagnostics",
    summary: "Pineapple now has lightweight console tracing for startup, execution, cron, and Telegram processing.",
    files: [
      "src/utils/trace.ts",
      "src/index.ts",
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/telegram/telegram-update-processor.ts"
    ],
    sections: [
      {
        title: "How it works",
        bullets: [
          "A small helper safely stringifies structured details and errors.",
          "Tracing defaults on in development and can be controlled through `TRACE_CONSOLE`."
        ]
      },
      {
        title: "Why this matters",
        bullets: [
          "The app remains operationally lightweight while still making its lifecycle and queue behavior easier to inspect."
        ]
      }
    ]
  },
  {
    id: "trigger-event",
    title: "Trigger Event",
    summary: "The `TriggerEvent` contract is the normalization seam between transports and execution.",
    files: [
      "src/execution/contracts/trigger-event.ts",
      "src/execution/contracts/trigger-prompt.ts"
    ],
    sections: [
      {
        title: "What it standardizes",
        bullets: [
          "Where the event came from: source kind, system, and event type.",
          "Who caused it: actor type and actor id.",
          "How it should be routed: thread, subject, or unbound creation.",
          "What the agent should receive: generic payload later parsed into a prompt."
        ]
      },
      {
        title: "Why this is central",
        bullets: [
          "It gives Pineapple a single inbound execution contract. New transports can be added without changing the orchestration core.",
          "Cron now uses the same contract, which shows the abstraction is working."
        ]
      }
    ]
  },
  {
    id: "daemon-concept",
    title: "Daemon Queue",
    summary: "The daemon is small but architecturally important because it is the source of ordering guarantees in a single-process deployment.",
    files: [
      "src/execution/queue/pineapple-daemon.ts",
      "src/execution/pipeline/dispatch.ts"
    ],
    sections: [
      {
        title: "What it buys Pineapple",
        bullets: [
          "No two execution mutations race within one process.",
          "Live triggers, approval resolutions, and recovery all share one ordered lane.",
          "The app can stay single-process and operationally cheap for v1."
        ]
      },
      {
        title: "What it does not solve",
        bullets: [
          "It is not distributed and does not coordinate across multiple app instances.",
          "If Pineapple later scales out, this is one of the first places likely to evolve."
        ]
      }
    ]
  },
  {
    id: "stores-db",
    title: "Stores And Database",
    summary: "The repository uses small store interfaces and Drizzle-backed implementations to keep domain code decoupled from persistence details.",
    files: [
      "src/threads/store/thread-store.ts",
      "src/execution/store/agent-execution-store.ts",
      "src/db/stores/thread-store.ts",
      "src/db/schema.ts"
    ],
    sections: [
      {
        title: "Pattern",
        bullets: [
          "Domain modules depend on store interfaces.",
          "Production wiring supplies Drizzle implementations.",
          "Tests can supply in-memory stores instead."
        ]
      },
      {
        title: "Architectural effect",
        bullets: [
          "The design stays explicit and simple without introducing a large repository framework or ORM-heavy abstractions."
        ]
      }
    ]
  }
];

const executionStates: ExecutionState[] = [
  {
    id: "queued",
    title: "Queued",
    summary: "The execution record exists and has accepted checkpoint data, but the daemon has not started running it yet.",
    notes: [
      "Created by `createAgentExecution()`.",
      "This is the first durable state after request acceptance.",
      "Recovery treats queued executions as replayable work."
    ]
  },
  {
    id: "running",
    title: "Running",
    summary: "The daemon has started processing the execution and Pineapple has marked the run active.",
    notes: [
      "Entered by `markExecutionRunning()`.",
      "May end in completion, failure, or awaiting approval.",
      "Recovery can continue it if there is serialized run state."
    ]
  },
  {
    id: "awaiting_approval",
    title: "Awaiting Approval",
    summary: "The runtime paused on an approval-required tool call and the execution now points to a pending human decision.",
    notes: [
      "Terminal for the current daemon turn, but not terminal for the business process.",
      "Keeps serialized `runState` so resumption is exact.",
      "On restart, recovery surfaces the pending decision instead of rerunning."
    ]
  },
  {
    id: "completed",
    title: "Completed",
    summary: "The run finished successfully and produced final output with no further action required.",
    notes: [
      "Thread `turnCount` and `lastResponseId` can be updated here.",
      "Checkpoint `runState` is cleared because the run is done."
    ]
  },
  {
    id: "failed",
    title: "Failed",
    summary: "Runtime execution raised an error and Pineapple stored error code and error message on the execution.",
    notes: [
      "The execution remains a durable audit of what was attempted.",
      "Checkpointed run state is preserved from the prior execution record when an exception occurs."
    ]
  },
  {
    id: "canceled",
    title: "Canceled",
    summary: "A terminal non-approval decision, such as rejection, stops the execution without producing a final output.",
    notes: [
      "Used after rejection or expiry-style terminal resolution paths.",
      "Clears run state because there is no future continuation."
    ]
  }
];

const persistenceCards = [
  {
    title: "threads",
    body: "Stores durable thread identity, optional business subject binding, title/description, thread metadata, delivery context, last response continuity, and closed/reopened state.",
    invariants: [
      "Subject type and subject id must both be null or both be non-null.",
      "Only one active thread may exist for the same subject pair."
    ]
  },
  {
    title: "agent_threads",
    body: "Stores runner session items and active agent state for each Pineapple thread.",
    invariants: [
      "Exactly one `agent_thread` per Pineapple thread.",
      "Session items are mutable runtime memory but still durable."
    ]
  },
  {
    title: "specialist_sessions",
    body: "Stores provider-side continuity state for a specific agent working on a specific thread.",
    invariants: [
      "Unique per `(thread_id, agent_id)`.",
      "Provider state is JSONB for backend-specific evolution."
    ]
  },
  {
    title: "agent_executions",
    body: "Stores run checkpoints, statuses, active agent, and resumable state for each execution attempt.",
    invariants: [
      "Unique `trigger_id` when present.",
      "Only one active execution per thread across queued/running/awaiting approval."
    ]
  },
  {
    title: "agent_execution_decisions",
    body: "Stores approval requests tied to specific tool calls and executions.",
    invariants: [
      "Only one pending decision per execution.",
      "Resolved decisions must satisfy resolution field rules enforced by the domain schema."
    ]
  }
];

const hotspots = [
  {
    title: "Read This First",
    description: "The startup story and top-level runtime composition. Start here to understand which subsystems exist and when they are initialized.",
    files: [
      "src/index.ts",
      "src/entrypoints/bootstrap/runtime.ts",
      "src/entrypoints/bootstrap/services.ts"
    ]
  },
  {
    title: "Cron Scheduling",
    description: "These files explain the new scheduled-work path and how reminders become normal Pineapple triggers.",
    files: [
      "src/adapters/cron/cron-adapter.ts",
      "src/adapters/cron/cron-scheduler.ts",
      "src/adapters/cron/cron-reminder.ts",
      "src/adapters/cron/cron-schedule-reminder-tool.ts"
    ]
  },
  {
    title: "Execution Brain",
    description: "The request dispatcher and runtime/approval/recovery modules are the real center of control flow in Pineapple.",
    files: [
      "src/execution/pipeline/service.ts",
      "src/execution/pipeline/dispatch.ts",
      "src/execution/pipeline/runtime.ts",
      "src/execution/pipeline/approval.ts",
      "src/execution/pipeline/recovery.ts"
    ]
  },
  {
    title: "Tracing + Enrichment",
    description: "These files explain the newer cross-cutting changes: structured console tracing, thread delivery context, and prompt enrichment after routing.",
    files: [
      "src/utils/trace.ts",
      "src/execution/pipeline/trigger-prompt-enrichment.ts",
      "src/threads/domain/thread-metadata.ts",
      "src/execution/contracts/trigger-prompt.ts"
    ]
  },
  {
    title: "Agent Graph",
    description: "These files explain how manifests become a runnable multi-agent graph with handoffs, tools, MCP servers, and provider continuity.",
    files: [
      "src/agents/agent-runtime.ts",
      "src/agents/runtime/agent-runtime-setup.ts",
      "src/agents/runtime/agent-runtime-turn.ts",
      ".pineapple/agents/root-manager.json",
      ".pineapple/agents/codex.json"
    ]
  },
  {
    title: "Adapters In Practice",
    description: "Read these to see how normalized trigger contracts are produced from real systems and how outbound tools get exposed.",
    files: [
      "src/adapters/shortcut/shortcut-adapter.ts",
      "src/adapters/telegram/telegram-update-processor.ts",
      "src/adapters/telegram/telegram-webhook.ts"
    ]
  },
  {
    title: "Durability Model",
    description: "These files define the durable data model and the database constraints that enforce architecture-level guarantees.",
    files: [
      "src/db/schema.ts",
      "src/db/stores/thread-store.ts",
      "src/db/stores/agent-execution-store.ts",
      "src/db/stores/agent-execution-decision-store.ts"
    ]
  },
  {
    title: "Architecture Guardrails",
    description: "The tests show what the author considers critical invariants, especially around active executions, pending decisions, and subject-bound thread uniqueness.",
    files: [
      "test/integration/architecture-invariants.test.ts",
      "test/execution/app-execution-modules.test.ts",
      "test/execution/app-execution-service.test.ts"
    ]
  }
];

function main() {
  renderHeroMetrics();
  renderArchitectureMap();
  renderScenarios();
  renderConcepts();
  renderStateMachine();
  renderPersistenceCards();
  renderHotspots();
}

function renderHeroMetrics() {
  const host = byId("hero-metrics");
  host.innerHTML = heroMetrics
    .map(
      (metric) => `
        <article class="metric-card">
          <strong>${metric.value}</strong>
          <span>${metric.label}</span>
          <p>${metric.copy}</p>
        </article>
      `
    )
    .join("");
}

function renderArchitectureMap() {
  const map = byId("architecture-map");
  const detail = byId("layer-detail");
  const lanes = groupByLane(layerNodes);
  const first = layerNodes[0];

  map.innerHTML = Array.from(lanes.entries())
    .map(
      ([lane, nodes]) => `
        <section class="map-lane">
          <div class="lane-header">
            <h4>${lane}</h4>
            <span>${nodes.length} components</span>
          </div>
          <div class="lane-grid">
            ${nodes
              .map(
                (node) => `
                  <button class="map-node${node.id === first.id ? " is-active" : ""}" data-layer-node="${node.id}">
                    <span class="node-kicker">${node.kicker}</span>
                    <h5>${node.title}</h5>
                    <p>${node.summary}</p>
                  </button>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");

  setLayerDetail(first, detail);

  map.querySelectorAll<HTMLButtonElement>("[data-layer-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.layerNode!;
      const node = layerNodes.find((candidate) => candidate.id === id);

      if (!node) {
        return;
      }

      map.querySelectorAll(".map-node").forEach((entry) => entry.classList.remove("is-active"));
      button.classList.add("is-active");
      setLayerDetail(node, detail);
    });
  });
}

function setLayerDetail(node: LayerNode, detail: HTMLElement) {
  detail.innerHTML = `
    <span class="detail-kicker">${node.kicker}</span>
    <h4>${node.title}</h4>
    <p>${node.summary}</p>
    <div class="detail-group">
      <h5>Responsibilities</h5>
      <ul class="detail-list">
        ${node.responsibilities.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    <div class="detail-group">
      <h5>Architecture Notes</h5>
      <ul class="detail-list">
        ${node.details.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    <div class="detail-group">
      <h5>Depends On / Touches</h5>
      <div class="legend-row">
        ${node.dependencies.map((item) => `<span class="action-chip">${item}</span>`).join("")}
      </div>
    </div>
    <div class="detail-group">
      <h5>Source Files</h5>
      <div class="detail-files">
        ${node.files.map((file) => `<span class="file-chip">${file}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderScenarios() {
  const tabs = byId("scenario-tabs");
  const header = byId("scenario-header");
  const steps = byId("scenario-steps");
  const detail = byId("scenario-detail");
  const first = scenarios[0];

  tabs.innerHTML = scenarios
    .map(
      (scenario) => `
        <button class="scenario-tab${scenario.id === first.id ? " is-active" : ""}" data-scenario="${scenario.id}">
          <strong>${scenario.kicker}</strong>
          <h5>${scenario.title}</h5>
          <p>${scenario.summary}</p>
        </button>
      `
    )
    .join("");

  setScenario(first, header, steps, detail);

  tabs.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      const scenario = scenarios.find((entry) => entry.id === button.dataset.scenario);

      if (!scenario) {
        return;
      }

      tabs.querySelectorAll(".scenario-tab").forEach((entry) => entry.classList.remove("is-active"));
      button.classList.add("is-active");
      setScenario(scenario, header, steps, detail);
    });
  });
}

function setScenario(
  scenario: Scenario,
  header: HTMLElement,
  stepsHost: HTMLElement,
  detail: HTMLElement
) {
  header.innerHTML = `
    <p class="eyebrow">${scenario.kicker}</p>
    <h4>${scenario.title}</h4>
    <p>${scenario.summary}</p>
    <div class="legend-row">
      <span class="action-chip">Trigger: ${scenario.trigger}</span>
      <span class="action-chip">Result: ${scenario.result}</span>
    </div>
  `;

  stepsHost.innerHTML = scenario.steps
    .map(
      (step, index) => `
        <li class="timeline-step${index === 0 ? " is-focused" : ""}" data-step-index="${index}">
          <div class="step-index">${index + 1}</div>
          <div>
            <h5>${step.title}</h5>
            <p>${step.summary}</p>
          </div>
        </li>
      `
    )
    .join("");

  setScenarioStepDetail(scenario, 0, detail);

  stepsHost.querySelectorAll<HTMLElement>("[data-step-index]").forEach((stepCard) => {
    stepCard.addEventListener("click", () => {
      const index = Number(stepCard.dataset.stepIndex);

      stepsHost.querySelectorAll(".timeline-step").forEach((entry) => entry.classList.remove("is-focused"));
      stepCard.classList.add("is-focused");
      setScenarioStepDetail(scenario, index, detail);
    });
  });
}

function setScenarioStepDetail(
  scenario: Scenario,
  stepIndex: number,
  detail: HTMLElement
) {
  const step = scenario.steps[stepIndex];

  detail.innerHTML = `
    <span class="detail-kicker">${scenario.kicker} Step ${stepIndex + 1}</span>
    <h4>${step.title}</h4>
    <p>${step.summary}</p>
    <div class="detail-group">
      <h5>Why It Matters</h5>
      <p>${step.whyItMatters}</p>
    </div>
    <div class="detail-group">
      <h5>Architecture Focus</h5>
      <div class="legend-row">
        ${(step.focusNodeIds ?? []).map((item) => `<span class="action-chip">${item}</span>`).join("")}
      </div>
    </div>
    <div class="detail-group">
      <h5>Source Files</h5>
      <ul class="timeline-files">
        ${step.files.map((file) => `<li>${file}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderConcepts() {
  const nav = byId("concept-nav");
  const panel = byId("concept-panel");
  const first = concepts[0];

  nav.innerHTML = concepts
    .map(
      (concept) => `
        <button class="concept-pill${concept.id === first.id ? " is-active" : ""}" data-concept="${concept.id}">
          <strong>${concept.title}</strong>
          <span>${concept.summary}</span>
        </button>
      `
    )
    .join("");

  setConcept(first, panel);

  nav.querySelectorAll<HTMLButtonElement>("[data-concept]").forEach((button) => {
    button.addEventListener("click", () => {
      const concept = concepts.find((entry) => entry.id === button.dataset.concept);

      if (!concept) {
        return;
      }

      nav.querySelectorAll(".concept-pill").forEach((entry) => entry.classList.remove("is-active"));
      button.classList.add("is-active");
      setConcept(concept, panel);
    });
  });
}

function setConcept(concept: Concept, panel: HTMLElement) {
  panel.innerHTML = `
    <p class="eyebrow">Concept</p>
    <h4 class="concept-title">${concept.title}</h4>
    <p>${concept.summary}</p>
    <div class="detail-group">
      <h5>Relevant Files</h5>
      <div class="detail-files">
        ${concept.files.map((file) => `<span class="file-chip">${file}</span>`).join("")}
      </div>
    </div>
    <div class="concept-sections">
      ${concept.sections
        .map(
          (section) => `
            <section class="concept-section">
              <h5>${section.title}</h5>
              <ul>
                ${section.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}
              </ul>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function renderStateMachine() {
  const host = byId("state-machine");
  const first = executionStates[0];

  host.innerHTML = `
    <article class="state-card">
      <p class="eyebrow">Execution Status</p>
      <h4>Execution State Machine</h4>
      <p class="persistence-copy">
        The queue and runtime update the `AgentExecution` status explicitly. Click a state to
        see what it means operationally.
      </p>
      <div class="state-pills">
        ${executionStates
          .map(
            (state) => `
              <button class="state-pill${state.id === first.id ? " is-active" : ""}" data-state="${state.id}">
                ${state.id}
              </button>
            `
          )
          .join("")}
      </div>
      <div id="state-detail"></div>
    </article>
  `;

  const detail = byId("state-detail");
  setStateDetail(first, detail);

  host.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = executionStates.find((entry) => entry.id === button.dataset.state);

      if (!state) {
        return;
      }

      host.querySelectorAll(".state-pill").forEach((entry) => entry.classList.remove("is-active"));
      button.classList.add("is-active");
      setStateDetail(state, detail);
    });
  });
}

function setStateDetail(state: ExecutionState, detail: HTMLElement) {
  detail.innerHTML = `
    <div class="detail-group">
      <h5>${state.title}</h5>
      <p>${state.summary}</p>
      <ul class="state-notes">
        ${state.notes.map((note) => `<li>${note}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderPersistenceCards() {
  const host = byId("persistence-grid");
  host.innerHTML = persistenceCards
    .map(
      (card) => `
        <article class="persistence-card">
          <h4>${card.title}</h4>
          <p>${card.body}</p>
          <ul class="state-notes">
            ${card.invariants.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

function renderHotspots() {
  const host = byId("hotspot-list");
  host.innerHTML = hotspots
    .map(
      (spot) => `
        <article class="hotspot-card">
          <h4>${spot.title}</h4>
          <p>${spot.description}</p>
          <div class="detail-files">
            ${spot.files.map((file) => `<span class="file-chip">${file}</span>`).join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function groupByLane(nodes: LayerNode[]) {
  const lanes = new Map<string, LayerNode[]>();

  for (const node of nodes) {
    const laneNodes = lanes.get(node.lane) ?? [];
    laneNodes.push(node);
    lanes.set(node.lane, laneNodes);
  }

  return lanes;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing expected element #${id}`);
  }

  return element;
}

main();
