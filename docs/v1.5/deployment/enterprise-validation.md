---
order: 12
title: Enterprise validation drills
description: Produce repeatable load, recovery, and availability evidence for an OpsKnight deployment.
---

# Enterprise validation drills

Run these drills against staging before production promotion and after material infrastructure,
database, or incident-processing changes. Store the output with the exact Git commit, image digest,
environment name, execution time, and approver.

## Load and latency

Use the manually triggered **Enterprise readiness drills** GitHub workflow. Supply an HTTPS staging
URL, virtual-user count, and duration. The k6 profile fails unless readiness availability remains
above 99%, request failures remain below 1%, p95 latency remains below 750 ms, and p99 remains below
1.5 seconds.

For a local k6 installation, run:

```bash
BASE_URL=https://staging.example.com VUS=20 DURATION=2m \
  k6 run scripts/load/opsknight-smoke.js
```

Increase load gradually. Define deployment-specific service-level objectives before treating the
default thresholds as contractual targets.

## Backup and restore

Create a PostgreSQL custom-format or SQL backup, then restore it into an isolated disposable
database:

```bash
scripts/verify-backup-restore.sh /absolute/path/to/opsknight.dump
```

The script never connects to the source database. It creates a temporary PostgreSQL container,
restores the supplied file, verifies the migration table and core incident/user tables, reports the
elapsed restore time, and removes the container. Run an additional application-level smoke test
with the backed-up `ENCRYPTION_KEY` before recording the recovery point objective as achieved.

## Application-pod failover

The failover script deliberately deletes one running application pod and probes the external
readiness endpoint for one minute. Run it only on an approved staging cluster:

```bash
CONFIRM_OPSKNIGHT_CHAOS=delete-one-app-pod \
OPSKNIGHT_NAMESPACE=opsknight \
OPSKNIGHT_HEALTH_URL=https://staging.example.com/api/health?mode=readiness \
  scripts/verify-k8s-failover.sh
```

The drill refuses to start unless at least two application pods are running. It fails if more than
one readiness request fails or replacement pods do not become ready within five minutes.

## Highly available Helm baseline

Start with `helm/opsknight/examples/values-enterprise-ha.yaml`. It configures three application
replicas, a two-pod disruption budget, autoscaling, rolling updates with zero unavailable replicas,
node spreading, network policy, and an external PostgreSQL boundary.

The bundled PostgreSQL StatefulSet is intentionally a single-instance starting topology. An
enterprise HA deployment must use managed or operator-controlled PostgreSQL with multi-zone
failover, point-in-time recovery, encrypted transport, monitoring, and separately tested backups.

## Evidence record

For each drill, retain:

- commit SHA and immutable image digest;
- staging environment and sanitized configuration revision;
- start/end timestamps and operator;
- raw workflow logs and uploaded JSON/text artifacts;
- measured latency, error rate, outage duration, restore duration, and recovery observations;
- linked incident or corrective action for every failed threshold;
- approval confirming that unresolved failures block production promotion.
