---
title: Choose integrated or split runtime
description: Compare OpsKnight runtime ownership, scaling, failure isolation, and database impact before selecting a topology.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [integrated runtime, split runtime, topology, scaling]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/runtime-role.ts
    - deploy/compose/docker-compose.split.yml
    - deploy/kubernetes/helm/opsknight/templates/
---

# Choose integrated or split runtime

The topology changes who owns background work. It is an operational contract, not only a packaging preference.

## Integrated runtime

The integrated application serves HTTP traffic and owns background responsibilities in one process. It has fewer moving parts and is suitable for evaluation or a small installation where independent scaling is not required.

Do not scale integrated replicas as though they were stateless web replicas. Each replica can also participate in background ownership, increasing database connections and changing scheduler/worker behavior.

Choose integrated when:

- one application failure domain is acceptable;
- Web and background work can share resources;
- a simple installation is more important than role isolation;
- the calculated database connection budget supports the selected replica count.

## Split runtime

Split mode separates Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector. A one-shot migration owner finishes before those long-running roles start.

Choose split when:

- Web traffic must scale separately from queues;
- critical paging work needs isolation from bulk work;
- a failing or saturated lane must not consume every application resource;
- Web should use PgBouncer transaction pooling;
- role-specific resource limits, rollout, and monitoring are required.

Split mode adds operational work: every role needs the same immutable image and compatible secrets, connections must be budgeted across all replicas, and the operator must watch role-specific health and backlog.

## Ownership rule

Run exactly one model against a database:

- integrated application; or
- split migration plus split long-running roles.

Never leave the integrated application running while starting split roles. In Compose, inspect `docker compose ... config --services`. In Kubernetes, inspect Deployments and their runtime-role environment. Duplicate ownership can cause avoidable load and confusing health signals even where leases protect individual jobs.

## Failure and scaling decisions

| Event | Integrated effect | Split effect |
|---|---|---|
| Web saturation | Can compete with background work | Scale or tune Web independently |
| Bulk queue surge | Can consume shared process resources | Bulk Worker is isolated |
| Critical paging delay | Shares the integrated failure domain | Critical Worker has its own resources |
| Scheduler failure | Application failure affects all responsibilities | Scheduler can be diagnosed separately |
| Status projection delay | Shares process resources | Status Projector has its own signal |
| Connection pressure | One combined pool model | Sum every role and replica; Web can use PgBouncer |

Scaling a role is not a substitute for diagnosing a blocked provider, database contention, or stale scheduler. Use queue age, throughput, database saturation, and role health together.

## Migration boundary

Schema migration must have exactly one owner. In split deployments, complete the migration Job or Compose migration service successfully before replacing long-running roles. Never send migrations through PgBouncer transaction pooling.

## Next steps

- [Understand runtime roles](./runtime-roles)
- [Plan database connections](./database-connections)
- [Install integrated Compose](../docker-compose/integrated)
- [Install split Compose](../docker-compose/split)

