# Pineapple Tech Stack

## Goal
Use the smallest practical stack that supports a durable, thread-first agent system without introducing extra infrastructure too early.

## V1 Stack

### Runtime
- Node.js 22
- TypeScript

### Application
- Fastify
- Official `openai` Node SDK
- Responses API
- Zod

### Persistence
- PostgreSQL 16
- Drizzle ORM
- SQL migrations through Drizzle

## Why This Stack
- keeps the core small and understandable
- supports direct use of the OpenAI SDK without extra orchestration frameworks
- gives durable storage for threads, runs, decisions, and checkpoints
- keeps routing, approvals, and recovery in application code
- avoids early operational overhead

## Initial Operating Model
- one repository
- one service
- one PostgreSQL database
- one runner in the same app process
- no separate worker service yet
- no queue system yet
- no distributed locking yet

## Later Deployment Option
To save money, Pineapple can later be self-hosted on a private machine and reached through Tailscale.

This works well with the current shape because the system is just:
- one Node service
- one PostgreSQL database
- one daemon process
- plain HTTP endpoints

Planned public ingress:
- use Tailscale Funnel for public webhook delivery into the self-hosted daemon

Important limit:
- Tailscale gives private network access, not public webhook delivery
- Funnel is the intended way to expose selected webhook endpoints without moving the whole system to a public host
- polling or a relay remain fallback options if Funnel is not suitable for a given integration

## Deliberately Not Included In V1
- Redis
- Kafka
- Temporal
- LangChain
- multi-agent framework
- event sourcing
- separate policy engine

## Minimal Testing Position
Testing is allowed, but it should stay lightweight at first.

Start by testing only:
- routing
- run state transitions
- approval pause and resume
- checkpoint recovery

## Build Order
1. Fastify app skeleton
2. PostgreSQL schema for `Thread`, `Run`, and `HumanDecision`
3. Drizzle models and migrations
4. normalized `TriggerEvent` contract
5. runner loop
6. OpenAI `responses.create` integration
7. tool registry
8. approval flow
9. recovery from checkpoint

## Decision
This is the approved starting stack for Pineapple unless a concrete operational problem justifies widening it.
