# Moderate Company Stack Learning Path

## Purpose
This path is for learning the kind of stack you are likely to see in a moderate-size software company.

The goal is not to learn every trendy tool.
The goal is to learn the most common architecture layers in the order they become useful.

This path assumes you want practical backend and full-stack experience built on top of a real app like Pineapple.

## What "Moderate Company" Usually Means
A moderate-size company usually does not start with:
- many microservices
- Kafka everywhere
- Kubernetes-heavy platform engineering
- highly specialized data systems

More often, it starts with a stable core:
- one frontend
- one main backend
- one relational database
- one cache or queue system
- a few workers
- basic cloud deployment
- basic observability

That is the stack worth learning first.

## Typical Stack Shape

### Application Layer
- `React` or `Next.js` for frontend
- `Node.js` backend using `Fastify`, `Express`, or `NestJS`
- TypeScript across frontend and backend

### Data Layer
- `Postgres` as the primary database
- ORM or query builder such as `Drizzle`, `Prisma`, or `Knex`
- migrations as part of normal development

### Runtime Support
- `Redis` for caching, rate limits, locks, sessions, or queue coordination
- worker processes for background jobs
- object storage such as `S3` for files

### Delivery and Operations
- `Docker` for local consistency and deployment packaging
- `GitHub Actions` for CI
- deployment target such as `Railway`, `Render`, `Fly.io`, `ECS`, or `Cloud Run`
- error tracking with `Sentry`
- logs and metrics

### Product Essentials
- authentication
- authorization
- input validation
- testing
- secrets management

## The Right Learning Principle
Learn the stack in layers.
Do not learn tools as disconnected topics.

Each new tool should solve a problem created by the previous stage.

Example:
- Postgres solves durable state
- Redis solves speed and coordination problems
- workers solve long-running or retryable tasks
- object storage solves file persistence
- CI/CD solves release consistency
- observability solves production debugging

## Recommended Learning Order

## Phase 1: Strong Monolith

### Goal
Be able to build one clean production-style application before splitting anything.

### Learn
- TypeScript backend structure
- route handlers
- service boundaries
- validation with `zod`
- Postgres schema design
- migrations
- error handling
- logging
- tests

### In This Repo
Pineapple already gives you a strong starting point:
- `Fastify`
- `Postgres`
- `Drizzle`
- explicit runtime contracts

### Exit Criteria
- you can design tables
- you can add endpoints safely
- you can validate input and output
- you can reason about failures without guessing

## Phase 2: Authentication and Product Boundaries

### Goal
Learn how real user-facing systems protect data and actions.

### Learn
- session-based auth vs JWT
- user identity
- roles and permissions
- protected routes
- ownership checks

### Why This Matters
Many personal projects skip auth.
Most real company systems cannot.

### Exit Criteria
- you understand login, session, token, and authorization differences
- you can protect routes and data correctly

## Phase 3: Redis Fundamentals

### Goal
Learn Redis as support infrastructure, not as a replacement for Postgres.

### Learn
- caching
- TTL
- rate limiting
- distributed locks
- ephemeral state

### Important Rule
Postgres remains system-of-record data.
Redis handles fast, temporary, or coordination-focused data.

### Exit Criteria
- you know when to use Redis
- you know when not to use Redis

## Phase 4: Queues and Workers

### Goal
Learn background processing in a realistic way.

### Learn
- queue basics
- workers
- retries
- backoff
- dead-letter thinking
- idempotency
- graceful shutdown

### In This Repo
This is the natural next step after the current in-memory daemon queue.

### Exit Criteria
- you can move long-running tasks out of the request path
- you can explain why retries require safe job design

## Phase 5: Files and External Services

### Goal
Learn how apps handle assets and third-party integrations.

### Learn
- `S3` or equivalent object storage
- signed URLs
- webhook processing
- outbound API calls
- retry strategy for external dependencies

### Why This Matters
A moderate company app usually talks to other systems and stores files somewhere outside the app server.

### Exit Criteria
- you can store files safely
- you can integrate external APIs without coupling core logic to vendors

## Phase 6: Docker and Local Environments

### Goal
Package the app so local setup and deployment are more consistent.

### Learn
- `Dockerfile`
- multi-service `docker compose`
- environment variables
- startup ordering
- local parity between machines

### Practical Outcome
You should be able to run:
- app
- postgres
- redis
- worker

With one local setup command.

### Exit Criteria
- you can containerize the app without confusion
- you understand service networking and env configuration

## Phase 7: CI/CD

### Goal
Learn how changes get checked and deployed consistently.

### Learn
- lint, test, typecheck in CI
- migration handling
- build pipelines
- deployment workflows
- rollback mindset

### Common Tool
- `GitHub Actions`

### Exit Criteria
- every push can be validated automatically
- deployments follow a repeatable process

## Phase 8: Observability

### Goal
Learn how teams understand failures in production.

### Learn
- structured logs
- request IDs
- error tracking
- metrics
- tracing basics

### Common Tools
- `Sentry`
- hosted logs
- Prometheus-style metrics

### Exit Criteria
- you can answer "what failed, where, and why" without reading random console output

## Phase 9: Cloud Deployment

### Goal
Deploy the app in a way that resembles a real company environment without jumping too early into platform complexity.

### Learn
- managed Postgres
- managed Redis
- app service deployment
- worker deployment
- environment and secrets management

### Good First Targets
- `Railway`
- `Render`
- `Fly.io`
- `Cloud Run`
- `ECS`

### Exit Criteria
- you can deploy API and worker separately
- you understand config differences between local and cloud

## Phase 10: Advanced Systems

### Goal
Only after the foundation is solid, learn the systems that larger organizations often add.

### Learn Later
- microservices
- event-driven architecture
- Kafka
- Kubernetes
- service meshes
- advanced tracing
- multi-region concerns

### Rule
Do not study these first.
They make more sense after you have already felt the limits of a modular monolith.

## Best Stack To Learn First
If you want one practical, realistic path, learn this stack:
- `Next.js` or `React`
- `Node.js` with `Fastify`
- `TypeScript`
- `Postgres`
- `Drizzle` or `Prisma`
- `Redis`
- `BullMQ` or similar queue
- `Docker`
- `GitHub Actions`
- `Sentry`
- `S3`

This is close enough to what many moderate-size teams actually use, while still being small enough to learn in a disciplined way.

## How This Maps To Pineapple
Your repo can evolve like this:

1. Keep the current `Fastify + Postgres + Drizzle` base.
2. Add `Dockerfile` and full Compose app service.
3. Add `Redis`.
4. Move daemon jobs to a queue worker.
5. Add structured logging and error tracking.
6. Add cloud deployment for app and worker.
7. Add auth only if the product starts needing real users or protected workflows.

That would be a realistic moderate-company learning path without overengineering the project.

## What To Avoid
- learning tools in isolation without building anything
- adding infrastructure before the app needs it
- using microservices to feel advanced
- treating Redis as a primary database
- adding Kubernetes before you understand app deployment basics
- copying "big tech" architecture into a small system

## Final Principle
The path is not:
- Node
- Postgres
- Redis
- Kafka
- Kubernetes

The better path is:
- build a strong app
- add durable data
- add support infrastructure
- add background execution
- add deployment discipline
- add observability
- scale architecture only when the simpler shape becomes a real constraint
