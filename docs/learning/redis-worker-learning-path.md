# Redis + Worker Learning Path

## Purpose
This note is for the point where Pineapple outgrows the current in-process daemon queue and you want to learn how to move toward:
- Redis-backed jobs
- a separate worker process
- cleaner API vs background execution boundaries

This is not required for the current project shape.
It is a learning path for the next level of architecture.

## Current State
Today, the app is simpler:
- one Node app
- one Postgres database
- one in-memory daemon queue

That means the queue exists only inside the running process.
It is good for learning the core flow first.

## What Redis Adds
Redis gives you a shared job queue between processes.

That lets you split responsibilities:
- API process accepts requests and enqueues jobs
- worker process pulls jobs and executes them
- jobs survive app restarts better than an in-memory queue

## What You Would Learn
- queue basics
- job lifecycle
- retries
- backoff
- delayed jobs
- worker concurrency
- idempotency
- graceful shutdown
- operational visibility

## Difficulty
If you keep scope small, this is low-to-medium difficulty.

The Docker part is easy:
- add Redis service
- add worker service

The app design part is medium:
- decide what becomes a job
- make jobs safe to retry
- separate HTTP request handling from background execution

The hard part is not Redis itself.
The hard part is correct behavior when jobs fail, repeat, or get interrupted.

## Best Small Learning Scope
If the goal is learning rather than production complexity, keep the first version to:
- `postgres`
- `redis`
- `api` service
- `worker` service
- one queue for trigger processing

Do not add multiple queues, schedulers, or event buses at first.

## Suggested Learning Order
1. Understand the current in-memory daemon queue.
2. Add Redis to Docker Compose.
3. Add a queue library such as BullMQ.
4. Change the API path so it enqueues a trigger job instead of running it inline.
5. Add a worker entrypoint that consumes the queue.
6. Add retry rules and logging.
7. Add idempotency checks so the same trigger does not run twice incorrectly.

## What Changes In This Repo
At a high level, the architecture would move from:
- app receives trigger
- in-process daemon runs trigger

To:
- app receives trigger
- app enqueues trigger job in Redis
- worker consumes job
- worker runs the same core orchestration

The important rule is this:
keep the core runner logic reusable.
Only move queue ownership and process boundaries.

## Good Signs You Are Ready
- you understand the current daemon lifecycle
- you can explain why retries need idempotency
- you want jobs to continue independently of the API process
- you want to learn multi-process application design

## What To Avoid Early
- multiple workers with different responsibilities
- complex fan-out job graphs
- mixing queue logic into core domain code
- using Redis as a fake primary database
- adding infrastructure faster than you understand failure cases

## Recommended Mindset
Treat Redis + workers as a runtime upgrade, not a rewrite of the domain model.

If you do this later, the ideal result is:
- same core contracts
- same runner behavior
- different execution transport

## Next Step When You Want To Start
When you are ready, make the smallest possible version:
- add Redis
- add one queue
- add one worker
- move trigger execution into jobs

That is enough to learn the main ideas without turning the project into infrastructure homework.
