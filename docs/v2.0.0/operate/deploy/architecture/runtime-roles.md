---
title: Understand OpsKnight runtime roles
description: Learn what each OpsKnight runtime role owns, how it fails, and which signals operators must monitor.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [runtime roles, scheduler, workers, status projector, web]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/runtime-role.ts
    - deploy/compose/docker-compose.split.yml
---

# Understand OpsKnight runtime roles

Split mode uses one migration owner and six long-running roles. Every role runs the same tested application image but starts with different ownership.

## Migration

Applies compatible schema migrations and maintained index installers before rollout. It must use a direct PostgreSQL connection and exit successfully. A failed migration blocks application rollout; it is not a reason to start old and new roles together.

## Web

Serves the UI, public and authenticated APIs, webhooks, authentication callbacks, realtime streams, and health endpoints. It is the only role that should receive ingress traffic. Web may use supported PgBouncer transaction pooling in split mode.

Watch request latency/error rate, readiness, realtime disconnects, webhook failures, and database-pool saturation.

## Scheduler

Finds due work and enqueues it. Scheduler health is not proven by a running process: monitor its heartbeat, lag, enqueue failures, and the age of scheduled work. Do not add replicas without including their database pools and lease behavior in the capacity plan.

## General Worker

Processes normal asynchronous work. Watch queue depth, oldest age, throughput, retry counts, and database/provider errors.

## Critical Worker

Processes latency-sensitive paging and incident work. Give it protected resources and alert on oldest-job age. A healthy General Worker does not compensate for a blocked critical lane.

## Bulk Worker

Processes high-volume or lower-urgency work. Scale only after determining whether the bottleneck is compute, database throughput, or a provider limit.

## Status Projector

Projects internal incident/service state into public status-page state. Monitor projection lag and publication failures separately from the public web endpoint.

## Shared requirements

All long-running roles need:

- the same immutable application revision;
- compatible stable encryption and authentication secrets;
- the correct direct or pooled database endpoint;
- outbound access needed by the work they own;
- graceful termination long enough to stop claiming work and finish or release in-flight work;
- role-specific readiness, heartbeat, queue, and error monitoring.

## Related guides

- [Integrated versus split](./integrated-vs-split)
- [Database connections](./database-connections)
- [Scaling signals](../../capacity/scaling-signals)
- [Health and metrics](../../reliability/health-and-metrics)
