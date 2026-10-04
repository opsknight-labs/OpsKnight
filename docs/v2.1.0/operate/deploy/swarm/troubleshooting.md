---
title: Troubleshoot OpsKnight on Docker Swarm
description: Diagnose manager, node, migration, secret, network, convergence, database, PgBouncer, and readiness failures.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm troubleshooting, service convergence, quorum]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed or degraded Swarm deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/scripts/health-check.sh, deploy/swarm/scripts/deploy.sh]
---

# Troubleshoot OpsKnight on Docker Swarm

## Before you begin

Capture node/quorum, stack services/tasks, service inspect, recent task logs, images, networks, secrets metadata, and database/provider health. Never print secret contents.

## Manager quorum is unhealthy

**Check:** manager reachability/state and Raft quorum.

**Recovery:** follow the established Swarm disaster-recovery procedure before any application deployment.

**Verify:** managers agree and stack/service operations succeed.

## Service does not converge

**Check:** `docker service ps --no-trunc`, placement constraints, node capacity/labels, image pull, secrets, overlay network, and health checks.

**Recovery:** correct the exact scheduler/task failure and let the maintained deploy script complete.

**Verify:** desired/actual replicas match without repeated replacement.

## Migration task fails

**Check:** task logs, direct database route, TLS/CA, credentials/privileges, image revision, and schema state.

**Recovery:** keep rollout blocked, correct the cause, and rerun the one-shot migration through maintained tooling.

**Verify:** exit zero precedes application convergence.

## Bundled database will not schedule

**Check:** `opsknight.database=true` node label, node availability, storage volume, placement, and resources.

**Recovery:** restore the intended durable node or execute database recovery; do not schedule the service onto an empty volume unintentionally.

**Verify:** expected database data/readiness is present before application rollout.

## Overlay network or load balancer fails

**Check:** Swarm TCP/UDP ports, MTU, node private addresses, published port, load-balancer target health, proxy headers/TLS/SSE.

**Recovery:** correct network or proxy infrastructure without exposing database/private pool ports.

**Verify:** external readiness, sign-in, realtime update, and signed webhook pass.

## Queue grows with healthy tasks

**Check:** role heartbeat, lane age/throughput, provider throttling, database/pool saturation, and correct runtime mode.

**Recovery:** remove the bottleneck and scale only with capacity headroom.

**Verify:** oldest age declines and synthetic incident completes.

## Next steps

- [Swarm upgrade](./upgrade)
- [Health and metrics](../../reliability/health-and-metrics)

