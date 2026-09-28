---
title: Deploy with Docker Swarm
description: Run OpsKnight as a Docker-native multi-node split deployment.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Docker Swarm, Swarm HA, multi-node Docker, high availability]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [deploy/swarm/docker-stack.yml, deploy/swarm/docker-stack.pgbouncer.yml]
---

# Deploy with Docker Swarm

Use Swarm when Docker-native multi-node scheduling is required and Kubernetes is
not the platform boundary. The stack separates web, scheduler, notification
lanes, and status projection; HA comes from replicas, placement, durable external
state, and tested failure handling—not from enabling Swarm alone.

## Before you begin

Prepare a multi-node Swarm, immutable OpsKnight image, durable PostgreSQL,
external TLS/load balancing, secret storage, and failure-domain labels. Budget
database connections before selecting replicas. Add the PgBouncer overlay only
for the supported Split topology.

## Deploy and verify

1. Install secrets and pin the stack image.
2. Deploy the base stack plus required external-DB, PgBouncer, or CA overlays.
3. Confirm one migration owner completes before web traffic is admitted.
4. Verify replicas and placement span the intended nodes.
5. Drain one worker node and confirm web, critical paging, scheduler ownership,
   and status projection recover without duplicate work.

The PR #777 Swarm measurements are **NOT CERTIFIED**. See
[benchmark results](../capacity/benchmark-results/) before interpreting them.

