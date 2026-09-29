---
title: Scrape OpsKnight with Prometheus
description: Securely collect OpsKnight metrics in Compose, Swarm, Helm, and Kustomize deployments.
type: deployment
product_area: observability
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/metrics, deploy/compose, deploy/kubernetes, deploy/swarm]
---

# Scrape OpsKnight with Prometheus

`GET /api/metrics` returns Prometheus text format. A request is authorized by
either an authenticated OpsKnight `ADMIN` session or the single value in
`PROMETHEUS_SCRAPE_TOKEN`, supplied as an exact Bearer token. Missing, malformed,
or incorrect credentials return `401 Unauthorized`.

## Before you begin

Generate a high-entropy token, set the same `PROMETHEUS_SCRAPE_TOKEN` on every
web replica, restart them, and permit the Prometheus network path to the web
service. Do not expose `/api/metrics` directly to the public Internet.

Verify the endpoint before configuring Prometheus:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $PROMETHEUS_SCRAPE_TOKEN" \
  https://opsknight.example.com/api/metrics
```

Success is HTTP 200 with `Content-Type: text/plain; version=0.0.4` and lines
such as `opsknight_build_info`, `opsknight_active_incidents`, and
`opsknight_job_queue`. The complete metric names, types, and bounded label sets
are maintained in [Metrics reference](../../reference/metrics/).

## Configure a scrape

For a Compose deployment on a private Docker network:

```yaml
scrape_configs:
  - job_name: opsknight
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/opsknight_metrics_token
    static_configs:
      - targets: ["opsknight-web:3000"]
```

- Compose and Swarm: attach Prometheus to a controlled network path and scrape
  the web runtime through its service address.
- Helm: render the selected values and create a `ServiceMonitor` only when the
  Prometheus Operator is installed.
- Kustomize: keep the Service, authentication secret, and scraper policy in an
  owned overlay.

For a Prometheus Operator installation, store the token in a Kubernetes Secret,
reference it with `bearerTokenSecret` in a `ServiceMonitor`, and select the web
Service. For Kustomize, keep that Secret, ServiceMonitor or scrape annotation,
and NetworkPolicy in an owned overlay rather than editing the base.

## Interpret and alert

Use `rate()` or `increase()` for counters ending in `_total`; do not sum gauges
across replicas unless the metric represents replica-local work that should be
aggregated. Group only by labels actually emitted. Start with alerts for oldest
pending-job age, undelivered-notification age, escalation lag, collector errors,
provider cooldowns, and failed external operations. Require a sustained window
to avoid paging on one scrape.

The database collectors have a two-second bound. A complete snapshot is cached
for 10 seconds; a degraded snapshot is cached for 60 seconds. When a collector
fails or remains in flight, affected series may be absent while
`opsknight_metrics_collection_errors` increases. Use cache age and hit/miss
counters to distinguish stable data from a degraded scrape.

## Rotate the token

OpsKnight accepts one scrape token; it has no overlap set. Update the secret and
all web replicas, then update Prometheus. Expect a short scrape interruption
unless your deployment can coordinate those changes atomically. Confirm a 200
response with the new token and verify the old token returns 401.

## Troubleshooting

- **Prometheus returns 401:** check for the exact `Authorization: Bearer <token>`
  header and confirm every web replica was restarted with the same value.
- **The connection is refused or times out:** check the Service target, ingress
  path, Docker/Kubernetes network, TLS trust, and NetworkPolicy.
- **A series is missing:** some series exist only after the corresponding code
  path runs; also inspect collector-error metrics and the 60-second degraded cache.
- **Values differ between scrapes:** runtime counters and gauges can be
  process-local. Keep the Prometheus `instance` label when diagnosing replicas.
