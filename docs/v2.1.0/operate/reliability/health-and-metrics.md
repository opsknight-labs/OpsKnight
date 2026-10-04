---
title: Health checks and metrics
description: Build alerts and operational diagnosis from readiness, deep health, Prometheus metrics, and synthetic journeys.
type: deployment
product_area: observability
audience: [operator]
reader:
  status: READER_COMPLETE
  task: Configure, alert on, and verify layered OpsKnight health and metrics monitoring.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/app/api/health/route.ts
    - src/app/api/health/deep/route.ts
    - src/app/api/metrics/route.ts
    - src/lib/runtime-capacity.ts
---

# Health checks and metrics

Monitor OpsKnight in layers. Process health removes a failed replica from service; dependency health shows whether a role can work; queue and provider signals show whether work is completing; synthetic response journeys prove the user outcome.

## Prerequisites

- Restrict `/api/health/deep` and `/api/metrics` to operator networks.
- Configure a strong `PROMETHEUS_SCRAPE_TOKEN` and store it in the monitoring system's secret store.
- Scrape every runtime role/replica where per-process worker state matters.
- Label dashboards by environment, deployment identity, runtime role, and instance.
- Establish normal queue-age and latency baselines before choosing alert thresholds.

## Configure platform probes

Use:

- `/api/health` for liveness.
- `/api/health?mode=readiness` for startup/readiness.
- `/api/health/deep` for authenticated diagnosis.

The shipped Kubernetes and Compose manifests are the baseline for cadence and failure thresholds. Route probes to the local container. Readiness failures should stop new traffic without automatically destroying every replica during a shared database outage; liveness should detect a stuck process without turning a downstream outage into a restart storm.

After deployment, inspect the JSON directly:

```bash
curl --fail-with-body 'https://opsknight.example.com/api/health?mode=readiness'
curl --fail-with-body \
  -H "Authorization: Bearer ${PROMETHEUS_SCRAPE_TOKEN}" \
  https://opsknight.example.com/api/health/deep
```

## Scrape metrics

Request metrics with the bearer token and reject non-success responses:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${PROMETHEUS_SCRAPE_TOKEN}" \
  https://opsknight.example.com/api/metrics
```

Do not put the token in a URL query string. Restrict egress and logs so headers are not captured. See the [Prometheus setup](prometheus.md) and [metrics reference](../../reference/metrics.md) for implemented names and labels.

## Minimum alert set

Alert on sustained conditions rather than isolated samples:

1. Readiness `503` or JSON `unhealthy`, grouped by role and deployment.
2. Scheduler missing/stale last-success when that role is expected to schedule.
3. Worker not running or lacking recent successful cycles when expected.
4. Oldest pending critical job age, then general and bulk lane age.
5. Pending/failed notification age and provider failure ratio.
6. Status projection backlog or stale publication.
7. Database connection demand/headroom, errors, lock wait, and query latency.
8. Realtime control-plane degradation and stale dashboard rollups.
9. Process/container memory, restart count, CPU, and request tail latency.
10. Synthetic incident response failure.

Page on user-impacting or fast-burn conditions. Ticket slower capacity trends. A large queue with low age may be a healthy burst; a small queue with one very old item may indicate stuck work.

## Run the diagnostic sequence

When OpsKnight appears unhealthy:

1. Check liveness and readiness for each replica, not only the load-balanced endpoint.
2. Compare `deploymentId` across replicas to detect a mixed rollout.
3. Query deep health and identify the owning role: database, scheduler, worker lane, realtime, notifications, or rollups.
4. Inspect relevant metrics over time, including oldest age and error ratios.
5. Inspect system logs using the same time range and deployment identity.
6. Check PostgreSQL and provider status before scaling workers.
7. Run a controlled synthetic journey after mitigation.

## Synthetic journey

Use a dedicated non-production service in the production control plane with clearly labelled test data:

1. Create or ingest a uniquely keyed test incident.
2. Verify notification delivery to a controlled destination.
3. Acknowledge and confirm escalation completes.
4. Resolve with a synthetic-test note.
5. Verify status projections only if the test service is intentionally included.

Do not run a synthetic alert through real paging targets without an approved maintenance/test window.

## Verify monitoring itself

At deployment and periodically thereafter:

- Prove an unauthorized deep-health and metrics request is rejected.
- Temporarily target a safe test alert threshold and confirm routing.
- Confirm dashboards distinguish disabled responsibilities from failures.
- Confirm alert links open the correct environment and time range.
- Confirm retention supports incident and postmortem investigation.

## Operate in production

Keep readiness probes, Prometheus scraping, durable logs, and synthetic journeys in separate failure domains where practical. Review thresholds after topology, replica, pool, or concurrency changes. Restrict deep-health and metrics endpoints to operator networks, and retain enough history to distinguish a transient provider delay from sustained queue saturation.

## Troubleshooting

### Readiness is degraded but returns 200

This is intentional for non-critical degradation. Parse `status` and component checks; do not rely only on HTTP status.

### Deep health returns 401

Use an administrator session or a bearer token exactly matching `PROMETHEUS_SCRAPE_TOKEN`. Check proxy forwarding of the `Authorization` header without logging it.

### Metrics are available but a worker is stale

Confirm the scrape target is the worker replica, its runtime role is correct, and its lane owns the pending work. Healthy web metrics cannot prove worker execution.

### Alerts fire during every rollout

Use startup/readiness grace that matches actual initialization, group by deployment identity, and require sustained failure. Do not suppress genuine post-rollout queue age or mixed-version conditions.

## Related pages

- [Health endpoint reference](../../reference/health.md)
- [Metrics reference](../../reference/metrics.md)
- [Health Center](health-center.md)
- [System logs](system-logs.md)
- [Scale OpsKnight](scaling.md)
