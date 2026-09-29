---
title: Troubleshoot OpsKnight Compose deployments
description: Diagnose and recover common Compose migration, readiness, topology, database, proxy, and worker failures.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [Compose troubleshooting, readiness, migration, workers]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed or degraded Compose deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/
    - src/app/api/health/route.ts
---

# Troubleshoot OpsKnight Compose deployments

Always use the deployment's recorded ordered file list in place of `<files>`.

## Before you begin

Capture state before restarting anything:

```sh
docker compose <files> ps -a
docker compose <files> config --services
docker compose <files> config --images
docker compose <files> logs --since=30m
docker stats --no-stream
df -h
```

Protect configuration and logs as sensitive data. Do not run `down --volumes` while troubleshooting.

## Migration exits non-zero

**Check:** inspect migration logs and test direct database DNS, TLS, credentials, version, schema state, and privileges. Confirm its URL does not use PgBouncer port `6432`.

**Recovery:** keep Web and workers stopped. Correct the direct connection or the release-specific migration cause, then rerun the one-shot migration owner once and require a successful exit.

**Verify:** migration exits zero, schema/index checks pass, and only then do long-running roles become ready.

## Readiness remains unhealthy

**Check:** call the readiness endpoint directly, inspect the affected role logs, database reachability, migration state, stable secrets, and role heartbeat dependencies.

```sh
curl --fail --show-error \
  'http://127.0.0.1:3000/api/health?mode=readiness'
```

**Recovery:** fix the failing dependency and recreate only the affected service when possible.

**Verify:** both direct and public HTTPS readiness succeed and the role stays healthy through its normal work interval.

## Split stack also starts integrated application

**Check:** `docker compose <files> config --services`. This means the split overlay or file order is wrong.

**Recovery:** stop the project without deleting volumes, correct the ordered files, confirm `opsknight-app` is absent, then start split roles.

**Verify:** exactly one ownership model is running and a synthetic incident completes normally.

## PostgreSQL reports too many connections

**Check:** sum every role's pool multiplied by replicas and compare active/waiting connections with the reserved budget.

**Recovery:** reduce pool/replica counts, preserve operator headroom, correct leaked or duplicated ownership, or add supported Web-only PgBouncer.

**Verify:** connection use remains below budget during peak and queues continue draining.

## PgBouncer is unhealthy or saturated

**Check:** structured endpoint/credentials, database allowlist, TLS/CA paths, client wait, and backend pool use.

**Recovery:** correct configuration or database capacity. Raising the client limit alone does not add backend capacity.

**Verify:** Web readiness and incident workflows pass while migration/workers remain on direct connections.

## Authentication redirects to localhost or HTTP

**Check:** `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, forwarded `Host`/protocol, and `TRUSTED_PROXY_HOPS`.

**Recovery:** correct the origin and proxy chain, then recreate Web/application.

**Verify:** sign-in and provider callbacks remain on the public HTTPS origin.

## Incidents update only after refresh

**Check:** proxy buffering and idle timeouts for server-sent events at every proxy/load-balancer hop.

**Recovery:** disable buffering and extend timeouts.

**Verify:** a state change appears live in another browser session without refresh.

## Workers are healthy but work is delayed

**Check:** lane-specific oldest age, throughput, retries, provider admission/throttling, database saturation, and heartbeat freshness.

**Recovery:** remove the actual bottleneck; scale only a supported worker after recalculating connections.

**Verify:** oldest age declines and a new synthetic incident completes inside the expected window.

## Next steps

- [Health and metrics](../../reliability/health-and-metrics)
- [System logs](../../reliability/system-logs)
- [Backup and restore](../../data/backup-and-restore)
- [Migration failure](../../../troubleshooting/upgrades/migration-fails)

