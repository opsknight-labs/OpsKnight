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

Collect the metric names and types listed in [Metrics reference](../../reference/metrics/)
from the documented metrics endpoint. Keep the endpoint private and configure
the authentication required by your installation.

- Compose and Swarm: attach Prometheus to a controlled network path and scrape
  the web runtime through its service address.
- Helm: render the selected values and create a `ServiceMonitor` only when the
  Prometheus Operator is installed.
- Kustomize: keep the Service, authentication secret, and scraper policy in an
  owned overlay.

Aggregate counters with rates over a window; do not sum gauges blindly. Alert on
sustained queue age, error rate, delivery failure, and unavailable runtime roles,
then correlate with health and system logs.

Rotate scrape credentials by overlapping the new credential, verifying a
successful scrape, and removing the old credential. For `401`, check the token;
for `403`, check network and authorization policy; for missing series, confirm
the code path has emitted the metric and that label filters are not excluding it.
