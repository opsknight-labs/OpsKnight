---
title: Accept a Swarm deployment for production
description: Verify Swarm quorum, topology, database, security, recovery, convergence, and incident behavior before go-live.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm production checklist, acceptance]
reader:
  status: READER_COMPLETE
  task: Complete production acceptance for an OpsKnight Swarm stack.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/, tests/docs/journeys/]
---

# Accept a Swarm deployment for production

## Prerequisites

Complete installation, external TLS load balancing, production database/backup, monitoring, and on-call ownership. Identify go/no-go and rollback decision-makers.

## Prepare the acceptance record

Record cluster/stack, image digest, runtime mode, database/pool class, service replicas/placement, secret version identifiers, public origin, test operator, and rollback window. Exclude secret values.

## Run production acceptance

1. Verify three-manager quorum and worker capacity after one planned drain.
2. Confirm immutable images and protected content-hashed secrets.
3. Require direct one-shot migration success and exclusive runtime ownership.
4. Confirm every service converges and role/queue signals advance.
5. Verify private database/pool networking and TLS public proxy/SSE/webhooks.
6. Verify database connections, backup, and isolated restore with matching secrets.
7. Run alert, notification, acknowledgement, escalation/assignment where configured, resolution, and status projection.
8. Drain/restart one application worker and confirm recovery within objective.
9. Confirm dashboards/alerts with the operational on-call.
10. Record evidence and explicit go/no-go.

## Verify acceptance

Do not accept on service convergence alone. Security, migration, recovery, notification, and end-to-end incident evidence must pass.

## Operate it in production

Repeat affected checks after cluster, topology, database, proxy, provider, secret, or release changes. Schedule restore, manager recovery, node drain, capacity, and upgrade drills.

## Troubleshooting failed acceptance

Use [Swarm troubleshooting](./troubleshooting), preserve state/logs, correct the underlying layer, and rerun downstream checks. Never bypass deployment validation or weaken TLS/secrets to force a pass.

## Change or undo the release decision

Stop new traffic where safe and invoke [Upgrade and rollback](./upgrade) or data recovery. Application/stack rollback does not reverse schema migration.

## Next steps

- [Health and metrics](../../reliability/health-and-metrics)
- [Backup and restore](../../data/backup-and-restore)

