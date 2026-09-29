---
title: Complete an OpsKnight Swarm installation
description: Use the maintained orchestrator to validate, create secrets, migrate, deploy, converge, and verify an OpsKnight stack.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm install, deploy script, migration]
reader:
  status: READER_COMPLETE
  task: Install and validate OpsKnight on Docker Swarm.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/scripts/deploy.sh, deploy/swarm/scripts/health-check.sh, deploy/swarm/scripts/migrate.sh]
---

# Complete an OpsKnight Swarm installation

## Prerequisites

Complete [Swarm prerequisites](./prerequisites) and [topology/database configuration](./topology-and-database). Run from a manager in a protected administrative session with all required values available.

## Prepare deployment values

Export the immutable image, public URLs, stable secrets, selected runtime mode, database, optional PgBouncer, stack name, replicas/resources, and capacity ceilings through the approved secret source. Do not commit values.

## Install the stack

For default split mode:

```sh
./deploy/swarm/scripts/deploy.sh
```

For integrated mode:

```sh
SWARM_RUNTIME_MODE=integrated ./deploy/swarm/scripts/deploy.sh
```

The script validates manager/capacity, creates network and content-hashed Swarm secrets, starts bundled database when selected, runs one-shot direct migration, deploys with prune, waits for convergence, and checks readiness. Do not replace it with routine manual `docker stack deploy` because that skips gates.

## Verify the installation

```sh
docker stack services <stack-name>
docker stack ps <stack-name> --no-trunc
./deploy/swarm/scripts/health-check.sh
```

Require desired replicas, no recurring task failures, migration exit zero, exclusive topology ownership, and readiness through the external HTTPS load balancer. Open `/setup`, create administrator/service, and run a synthetic incident through notification, acknowledgement, resolution, and status projection.

## Operate it in production

Monitor manager quorum, node state, service convergence, role queues/heartbeats, provider/database/pool signals, load balancer, storage, backup, and secrets/certificate expiry. Drain nodes one at a time and observe capacity/disruption.

## Troubleshooting

**Deploy script stops at preflight:** correct the reported image, secret, capacity, node-label, or database issue; do not bypass validation.

**Migration service fails:** preserve task logs and keep stack rollout blocked until direct database/TLS/privilege/migration succeeds.

**Service does not converge:** inspect `docker service ps --no-trunc`, placement, resources, image pull, secrets, network, and health.

**External readiness fails:** compare an internal task/Service request with load balancer/TLS/proxy behavior.

## Change or remove the installation

Use [Upgrade and rollback](./upgrade). Before `docker stack rm`, take a verified backup and understand local volume retention. Stack removal is not database recovery.

## Next steps

- [Production checklist](./production-checklist)
- [Swarm troubleshooting](./troubleshooting)

