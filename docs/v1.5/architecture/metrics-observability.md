# Metrics and observability contract

OpsKnight exposes authenticated Prometheus metrics at `/api/metrics`. Configure a high-entropy
`PROMETHEUS_SCRAPE_TOKEN` through a Secret; never put it in a ConfigMap or image.

Operator setup, the complete metric catalog, safe multi-replica PromQL, recording/alert rules, and
deployment-specific examples are documented in the [Prometheus metrics guide](../deployment/prometheus).

Metrics declare one of three aggregation scopes. Instance metrics are scraped per replica. Counters
are aggregated with `sum` or `rate`. Cluster snapshot gauges are deliberately exposed by every
replica for availability and must use the shipped `max without(instance,pod)` recording rules—never
`sum`.

The exporter keeps local telemetry available when a database collector fails and reports the number
of failed collectors. `/api/health` is cheap liveness, `/api/health?mode=readiness` validates the
configured process role, and authenticated `/api/health/deep` exposes scheduler, worker, queue,
notification, and rollup diagnostic state.

The metric registry prohibits identifiers, email addresses, URLs, request IDs, IPs, and exception
messages as labels. Those values belong only in sanitized structured logs and traces.
