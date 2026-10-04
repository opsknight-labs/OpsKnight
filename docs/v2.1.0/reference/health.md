---
title: Health endpoint reference
description: HTTP status, authentication, fields, and intended use of liveness, readiness, and deep diagnostics.
type: reference
product_area: observability
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/app/api/health/route.ts
    - src/app/api/health/deep/route.ts
    - src/app/api/metrics/route.ts
---

# Health endpoint reference

OpsKnight exposes a cheap liveness mode, dependency-aware readiness mode, and authenticated deep diagnostics. They answer different questions and should not share the same polling policy.

## `GET /api/health`

Without a query parameter, the endpoint runs in `liveness` mode. It reports process identity, uptime, version, deployment identity, environment, memory, and overall state.

```bash
curl --fail-with-body https://opsknight.example.com/api/health
```

Liveness always returns HTTP `200` when the handler responds, even when the JSON `status` is `unhealthy`. A liveness consumer must parse the response body if it needs semantic state. Deployment probes use this endpoint to decide whether the process is alive, not whether every dependency is ready.

Memory is reported in `checks.memory`: `latency` is heap used in MiB. Heap use over 92% of the V8 heap limit is marked unhealthy. This threshold is a process signal, not a replacement for container-memory alerts.

## `GET /api/health?mode=readiness`

Readiness checks dependencies required by the current runtime role:

```bash
curl --fail-with-body 'https://opsknight.example.com/api/health?mode=readiness'
```

The response includes:

- `database` — a `SELECT 1` check with a five-second timeout.
- `notificationControlPlane` — provider admission/control-plane certification.
- `scheduler` — healthy, unhealthy, or disabled based on role and `ENABLE_INTERNAL_CRON`.
- `worker` — present when the role owns a local worker; evaluates running state and recent successful cycles.
- `memory` — diagnostic process memory, excluded from the readiness-critical set.

Readiness returns HTTP `503` for a critical dependency failure. `degraded` returns HTTP `200`. The notification control-plane failure is critical only when `NOTIFICATION_CONTROL_PLANE_STRICT=true` on a `web` or `integrated` role; otherwise it degrades readiness without removing the replica.

Scheduler staleness uses `SCHEDULER_HEALTH_MAX_INTERVAL_SECONDS`, with a minimum cadence of 30 seconds, and becomes unhealthy after five times the configured maximum interval. Worker startup/recent-success windows are derived from the worker's idle poll interval.

## Standard response fields

- `status`: `healthy`, `degraded`, or `unhealthy`.
- `mode`: requested mode; deployments should use only documented `liveness` and `readiness` behavior.
- `timestamp`: server timestamp in ISO format.
- `checks`: component results with `status` plus optional latency, error, and expected fields.
- `uptime`: rounded process uptime in seconds.
- `version`: application version.
- `deploymentId`: build/deployment identity; use this to compare an HA replica set.
- `environment`: current Node environment.
- `instanceId`: process-local diagnostic identifier. Do not use it to decide whether replicas run the same build.

Responses disable caching.

## `GET /api/health/deep`

Deep health is an operator diagnostic endpoint. It requires either:

- `Authorization: Bearer <PROMETHEUS_SCRAPE_TOKEN>` when the token is configured, or
- an authenticated OpsKnight administrator session.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${PROMETHEUS_SCRAPE_TOKEN}" \
  https://opsknight.example.com/api/health/deep
```

An unauthorized request returns HTTP `401`. Do not expose this endpoint through an unauthenticated public ingress.

Deep health reports worker, scheduler, realtime control plane, dashboard analytics, pending jobs and oldest age, pending/failed notifications and oldest age, and the latest daily metric rollup. Its top-level status is `degraded` when any of the three database diagnostic queries fails; individual runtime objects contain additional state.

Deep health is more expensive than liveness and should be polled at an operator cadence, not on every load-balancer probe.

## Probe guidance

- Liveness: `/api/health`
- Readiness and startup: `/api/health?mode=readiness`
- Operator diagnosis: `/api/health/deep`

Use the timing and failure thresholds from the selected deployment manifests as the starting point. Ensure the probe reaches the local runtime instance rather than a load balancer that can hide one unhealthy replica.

## Interpretation cautions

- HTTP `200` alone does not mean liveness JSON is healthy.
- A readiness `200` may be `degraded`; alert on the JSON state as well as HTTP failures.
- `disabled` means the current role is not expected to own that responsibility.
- Healthy readiness does not prove queue latency, provider delivery, or every end-to-end journey is healthy. Combine it with deep health, metrics, and synthetic checks.

See [Health checks and metrics](../operate/reliability/health-and-metrics.md) and [Metrics reference](metrics.md).
