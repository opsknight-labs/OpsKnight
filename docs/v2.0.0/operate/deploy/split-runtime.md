---
title: Operate the split runtime
description: Separate web, scheduler, worker, projector, and migration ownership.
type: deployment
product_area: deployment
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/runtime-capacity.ts
    - deploy/compose/docker-compose.split.yml
---

# Operate the split runtime

The split topology assigns one process role per workload: web serves requests;
the scheduler owns timed maintenance; general, critical, and bulk workers claim
their traffic classes; the status projector updates public projections; and the
migration job owns schema migration.

Do not run integrated and split owners for the same work accidentally. Budget
database connections across replicas, preserve idempotent claim boundaries, and
monitor stale leases, queue depth, oldest work, throughput, and readiness before
changing concurrency.

