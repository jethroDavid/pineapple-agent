# Pineapple Learning Path

## 1. Purpose
This learning path is for building and understanding Pineapple as a small, extensible, thread-first agent system.

It is designed to teach the system in the same order it should be built:
- core concepts first
- stable contracts second
- integrations third
- scaling concerns last

The path assumes the goal is not to build the most flexible system. The goal is to build the smallest system that is durable, understandable, and easy to extend without changing the core.

## 2. Final Outcome
By the end of this path, you should be able to:
- explain the full lifecycle of a thread and a run
- route events into a normalized trigger contract
- execute tools without coupling orchestration to any specific integration
- pause risky actions for approval
- recover from crashes using durable checkpoints
- add Slack, Shortcut, or another integration with minimal or no core changes

## 3. Learning Rules
1. Learn the invariants before implementation details.
2. Learn the core before integrations.
3. Learn one extension surface at a time.
4. Do not introduce concurrency machinery before the single-runner model is clear.
5. Do not add abstractions that merely rename the architecture.

## 4. Sequential Checklist
- [ ] Understand the system shape
- [ ] Understand the core data model
- [ ] Understand the daemon as a runtime role
- [ ] Understand why `run.status` is the execution truth
- [ ] Understand the trigger contract
- [ ] Understand deterministic routing
- [ ] Understand the OpenAI continuity model
- [ ] Understand the runner loop
- [ ] Understand tool registration and execution rules
- [ ] Understand approval flow
- [ ] Understand checkpointing and recovery
- [ ] Understand how to add a new inbound integration
- [ ] Understand how to add a new tool
- [ ] Understand when multi-thread concurrency is allowed
- [ ] Understand what is deliberately deferred

## 5. Phase 1: System Shape

### Goal
Understand what Pineapple is and what it is not.

### Study
- thread-first orchestration
- one run as the execution unit
- small core, explicit extension surfaces
- daemon as the long-running process that hosts adapters and the runner
- no integration-specific logic inside the runner

### Questions To Answer
- What belongs in the core?
- What belongs in the daemon runtime but not in the core model?
- What belongs in an adapter?
- What belongs in a tool?
- Why is approval notification an extension surface instead of core orchestration?

### Exit Criteria
- [ ] Can explain the difference between the core and the extension surfaces
- [ ] Can explain why the daemon is a runtime role rather than a new domain model
- [ ] Can explain why Slack and Shortcut should not appear in runner logic

## 6. Phase 2: Core Data Model

### Goal
Learn the minimum durable state needed to run the system safely.

### Study
- `Thread`
- `Run`
- `HumanDecision`

### Focus
`Thread`:
- conversation container
- optional subject binding
- durable, not transient

`Run`:
- one execution attempt
- holds execution state
- carries checkpoint state

`HumanDecision`:
- approval record for risky side effects
- pauses and resumes a run

### Questions To Answer
- Why does `Thread` not have execution status?
- Why can one thread have many runs over time?
- Why should there be only one non-terminal run per thread?

### Exit Criteria
- [ ] Can explain each field in `Thread`, `Run`, and `HumanDecision`
- [ ] Can explain why `run.status` replaces thread-level execution status
- [ ] Can explain why one thread may have many sequential runs

## 7. Phase 3: Trigger Contract

### Goal
Understand the single input shape that all adapters must produce.

### Study
- normalized `TriggerEvent`
- `trigger_id` as idempotency key
- source metadata
- actor metadata
- routing metadata
- explicit unbound-thread allowance
- payload boundary

### Questions To Answer
- Why should adapters normalize into one internal contract?
- Why should orchestration reject raw integration payloads?
- What makes a good `trigger_id`?
- Why must unbound triggers be explicit?

### Practice
Map each of these into `TriggerEvent`:
- a Slack mention
- a Shortcut webhook
- a CLI command
- an internal system event

### Exit Criteria
- [ ] Can produce a valid `TriggerEvent` from multiple sources
- [ ] Can explain why this contract keeps the runner integration-agnostic

## 8. Phase 4: Routing

### Goal
Understand how events find threads without relation tables or tie-break logic.

### Study
Routing order:
1. `thread_id`
2. `subject_type` + `subject_id`
3. create thread
4. reject if no valid routing information exists

### Questions To Answer
- Why must routing be deterministic?
- Why is multi-match routing a design smell here?
- Why is direct subject binding simpler than a relation system?

### Practice
Describe how the system should behave for:
- a trigger with `thread_id`
- a trigger with subject but no thread
- a trigger with no thread and no subject

### Exit Criteria
- [ ] Can explain the routing order from memory
- [ ] Can explain why the architecture rejects tie-break rules

## 9. Phase 5: OpenAI Continuity

### Goal
Understand how Pineapple continues conversations without building a second memory system.

### Study
- `last_response_id`
- `previous_response_id`
- one continuity strategy per thread

### Questions To Answer
- Why is `previous_response_id` enough for the first version?
- Why should the system avoid mixing multiple continuity modes in one thread flow?
- What belongs to OpenAI versus Pineapple at this boundary?

### Practice
Explain the lifecycle of a thread across two sequential runs that both continue the same OpenAI conversation.

### Exit Criteria
- [ ] Can explain how the system continues the same OpenAI thread
- [ ] Can explain why the app stores only the minimum continuity state

## 10. Phase 6: Runner Loop

### Goal
Understand the single orchestration loop that drives the system.

### Study
Runner responsibilities:
1. accept normalized trigger
2. route to thread
3. create run
4. call OpenAI
5. execute tools
6. pause for approval when required
7. resume after approval
8. finalize run

### Questions To Answer
- Why should there be one runner instead of multiple orchestration services?
- Why should the runner be integration-agnostic?
- Why should tool execution within a run be sequential?

### Exit Criteria
- [ ] Can describe the runner loop in order
- [ ] Can explain why orchestration belongs in code rather than being split into many runtime components

## 11. Phase 7: Daemon Runtime

### Goal
Understand how the system stays alive at runtime without turning daemon behavior into a new core abstraction.

### Study
- one daemon process hosting adapters and the runner
- daemon as runtime container, not execution truth
- creating or claiming queued runs
- resuming runs after approval resolution or recovery

### Questions To Answer
- Why is daemon a runtime role instead of a new data model?
- Why should the daemon reuse the same runner contracts?
- What should stay in the runner instead of moving into daemon-specific logic?

### Exit Criteria
- [ ] Can explain what the daemon does at runtime
- [ ] Can explain what the daemon must not own
- [ ] Can explain how daemon can scale later without changing the core model

## 12. Phase 8: Tools

### Goal
Understand how new capabilities are added without changing the core.

### Study
Each tool has:
- name
- input schema
- output schema
- executor
- `side_effecting`
- `approval_required`
- `idempotent`

### Questions To Answer
- Why should tools be added by registration?
- Why should approval be tool metadata rather than naming convention?
- Why does idempotency matter for recovery?

### Practice
Design two tool definitions:
- one read-only tool
- one side-effecting tool that requires approval

### Exit Criteria
- [ ] Can explain how to add a new tool without changing runner logic
- [ ] Can explain how tool metadata drives safe execution

## 13. Phase 9: Approval Flow

### Goal
Understand how risky actions pause safely for human review.

### Study
Approval flow:
1. runner detects approval-required tool call
2. checkpoint is persisted
3. `HumanDecision` is created
4. run enters `awaiting_approval`
5. notifier sends approval request
6. human resolves decision
7. runner resumes or finalizes

### Questions To Answer
- Why is approval a state transition instead of an interrupt?
- Why should approval delivery channel be separate from decision state?
- What happens on rejection or expiry?

### Exit Criteria
- [ ] Can explain the approval lifecycle end to end
- [ ] Can explain why approval notification is an extension surface

## 14. Phase 10: Checkpointing and Recovery

### Goal
Understand how the system recovers without replaying work blindly.

### Study
Checkpoint boundaries:
- after run creation
- after persisted OpenAI response
- before side-effecting tool execution
- after persisted tool result
- before `awaiting_approval`
- after approval resolution
- before final completion

### Questions To Answer
- Why do checkpoints happen at orchestration boundaries?
- Why is replay dangerous for side-effecting tools?
- Why must recovery resume from durable state instead of memory?

### Practice
Describe expected recovery behavior for:
- crash before tool execution
- crash after a tool result is persisted
- crash while awaiting approval

### Exit Criteria
- [ ] Can explain each checkpoint boundary and why it exists
- [ ] Can explain how recovery works without inventing a large event-sourcing system

## 15. Phase 11: Extensibility

### Goal
Learn how to extend the system without widening the core.

### Study
Inbound extensibility:
- add a new adapter
- emit `TriggerEvent`
- avoid touching runner logic

Outbound extensibility:
- add a new tool
- register it
- avoid touching runner logic

Approval extensibility:
- add a new notification channel
- keep decision and resume logic unchanged

### Questions To Answer
- What changes when adding Slack?
- What changes when adding Shortcut?
- What should never change when adding those integrations?

### Practice
For each integration below, list only the pieces that should be added:
- Slack
- Shortcut
- GitHub
- internal knowledge base

### Exit Criteria
- [ ] Can explain how to add a new inbound integration with minimal core change
- [ ] Can explain how to add a new outbound integration with minimal core change
- [ ] Can explain how to keep the runner free of integration-specific branches

## 16. Phase 12: Concurrency

### Goal
Understand where concurrency is allowed and where it is forbidden.

### Study
- one thread may have many runs over time
- one thread may not have multiple non-terminal runs at once
- different threads may be processed concurrently
- start with one daemon process hosting one runner
- add multi-worker claiming only when throughput requires it

### Questions To Answer
- Why is concurrency allowed across threads?
- Why is concurrency forbidden within a thread?
- Why should locking wait until multi-worker execution is actually needed?

### Exit Criteria
- [ ] Can explain the concurrency model clearly
- [ ] Can explain why distributed coordination is deferred

## 17. Phase 13: Deliberate Non-Goals

### Goal
Understand what not to build yet.

### Study
Deferred items:
- multi-agent topology
- subject relation tables
- thread execution status separate from run status
- general `awaiting_input`
- distributed leases and heartbeats
- queue merge logic
- rich event-sourcing
- standalone policy engine
- integration-specific orchestration branches

Included runtime item:
- one daemon process hosting adapters and the runner

### Questions To Answer
- Why are these excluded from the first version?
- What kind of evidence should justify adding them later?

### Exit Criteria
- [ ] Can defend why these pieces are deferred
- [ ] Can explain what kind of real failure would justify adding one later

## 18. Suggested Build Order
1. Thread, Run, and HumanDecision models
2. `TriggerEvent` contract
3. deterministic routing
4. single runner loop
5. OpenAI continuity with `previous_response_id`
6. minimal daemon shell that hosts the runner
7. tool registration and execution
8. approval flow
9. checkpointing and recovery
10. first adapter integration
11. first side-effecting integration tool
12. concurrent processing across different threads

## 19. Practical Milestones

### Milestone 1
Accept a CLI trigger, create a thread, create a run, call OpenAI, and complete the run without tools.

### Milestone 2
Wrap the runner in one daemon process so the system can stay alive and process triggers continuously.

### Milestone 3
Add routing by subject and continue the same conversation with `previous_response_id`.

### Milestone 4
Add one read-only tool and execute it safely inside the runner loop.

### Milestone 5
Add one approval-required tool and complete the full approval flow.

### Milestone 6
Crash and recover safely from a persisted checkpoint.

### Milestone 7
Add a real integration adapter such as Slack or Shortcut without changing runner logic.

## 20. Common Mistakes
1. Putting execution truth on `Thread` instead of `Run`.
2. Letting adapters call OpenAI directly.
3. Passing raw integration payloads into orchestration.
4. Adding routing tie-break logic instead of fixing uniqueness.
5. Adding integration-specific branches inside the runner.
6. Letting tool naming imply policy instead of declaring policy in metadata.
7. Letting the daemon grow its own orchestration rules instead of reusing the runner.
8. Replaying side-effecting tools without idempotency rules.
9. Treating approval as a UI concern instead of a durable state transition.
10. Adding new architecture because it feels clean rather than because the current design failed.

## 21. Completion Checklist
- [ ] Can explain the whole architecture from trigger to final run status
- [ ] Can explain why `Run` owns execution state
- [ ] Can explain what the daemon is responsible for at runtime
- [ ] Can explain why adapters and tools are the main extension surfaces
- [ ] Can add a new adapter without changing the runner
- [ ] Can add a new tool without changing the runner
- [ ] Can explain the approval flow from memory
- [ ] Can explain checkpoint and recovery behavior from memory
- [ ] Can explain where concurrency is allowed and where it is not
- [ ] Can explain what is intentionally deferred and why
