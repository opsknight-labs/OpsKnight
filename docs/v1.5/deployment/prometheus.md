---
order: 7
title: Prometheus metrics
description: Securely scrape OpsKnight metrics with Prometheus, Prometheus Operator, Helm, Kustomize, Docker Compose, and Grafana.
---

# Prometheus metrics

OpsKnight exposes Prometheus text-format operational metrics from:

```text
GET /api/metrics
```

The endpoint is authenticated. For unattended scraping, every OpsKnight replica must receive the
same high-entropy `PROMETHEUS_SCRAPE_TOKEN`, and the scraper must send it as a Bearer token.

This is different from the Prometheus Alertmanager integration:

- **Prometheus scrapes OpsKnight** at `GET /api/metrics` to monitor OpsKnight itself.
- **Alertmanager sends alerts to OpsKnight** at `POST /api/integrations/prometheus` to create and
  resolve incidents. Configure that separately in the
  [Prometheus / Alertmanager integration guide](../integrations/metrics-alerting/prometheus).

## What the exporter covers

The exporter publishes low-cardinality operational signals for HTTP traffic, active incidents and
users, durable jobs, notification backlog, escalation lag, analytics-rollup freshness, and exporter
collector/cache health. It does not replace PostgreSQL, container, node, ingress, certificate, or
backup monitoring. Collect those with the platform's normal exporters and alerts.

## Authentication and endpoint behavior

Generate a dedicated token with at least 32 random bytes:

```bash
openssl rand -hex 32
```

Store the result in the deployment secret system as `PROMETHEUS_SCRAPE_TOKEN`. Do not place it in a
ConfigMap, container image, source-controlled values file, scrape URL, dashboard variable, or metric
label.

Verify the endpoint from a trusted machine without printing the token:

```bash
read -rsp 'Prometheus scrape token: ' PROMETHEUS_TOKEN; echo
curl --fail --show-error \
  --header "Authorization: Bearer ${PROMETHEUS_TOKEN}" \
  https://ops.example.com/api/metrics
unset PROMETHEUS_TOKEN
```

Expected behavior:

- a valid Bearer token returns HTTP 200 and `text/plain; version=0.0.4`;
- a missing or invalid token returns HTTP 401, unless the request carries a valid Admin session;
- an Admin can inspect the endpoint interactively without configuring a scrape token;
- an unset `PROMETHEUS_SCRAPE_TOKEN` does **not** allow anonymous scraping; and
- a failed database collector does not discard healthy process metrics. The response reports the
  partial failure through `opsknight_metrics_collection_errors`.

Database-backed collectors have a two-second timeout. Successful snapshots are cached for about ten
seconds; degraded snapshots back off for about one minute to avoid a scrape-driven query storm.

## Standalone Prometheus configuration

Mount the token into Prometheus as a read-only file, then add this job to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: opsknight
    scheme: https
    metrics_path: /api/metrics
    scrape_interval: 30s
    scrape_timeout: 5s
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/opsknight/scrape-token
    static_configs:
      - targets:
          - ops.example.com
```

Use the internal Service DNS name and `scheme: http` when Prometheus runs inside the same trusted
cluster. Use the public HTTPS origin only when cluster-local routing is unavailable. Do not disable
TLS verification to work around certificate or hostname errors.

Reload Prometheus, then open **Status → Targets** and confirm that `job="opsknight"` is `UP`:

```bash
promtool check config /etc/prometheus/prometheus.yml
curl --fail http://prometheus.example.com/-/ready
```

The expression `up{job="opsknight"}` should return `1` for every scraped replica.

## Docker Compose

The supplied `docker-compose.yml` passes `PROMETHEUS_SCRAPE_TOKEN` from the host environment into the
application container. Add the token to the protected `.env` or your Compose secret-injection layer:

```dotenv
PROMETHEUS_SCRAPE_TOKEN=REPLACE_WITH_64_HEX_CHARACTERS
```

Recreate the application so it receives the new value:

```bash
docker compose up -d --force-recreate opsknight-app
docker compose exec opsknight-app printenv PROMETHEUS_SCRAPE_TOKEN >/dev/null
```

Do not use `docker compose config` in shared logs after adding production secrets because rendered
environment values may be displayed. Configure Prometheus with the same token through a protected
credentials file. If Prometheus joins `opsknight-network`, its target can be
`opsknight-app:3000`; otherwise scrape the protected HTTPS origin.

## Helm with Prometheus Operator

The chart can render a `ServiceMonitor`. It intentionally fails rendering when the monitor is enabled
without an existing token Secret, preventing an unauthenticated or permanently failing monitor.

Create the Secret in the OpsKnight namespace:

```bash
kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -
kubectl -n opsknight create secret generic opsknight-metrics \
  --from-literal=PROMETHEUS_SCRAPE_TOKEN="$(openssl rand -hex 32)"
```

Add this to the production values file:

```yaml
metrics:
  enabled: true
  path: /api/metrics
  scrapeTokenSecret:
    existingSecret: opsknight-metrics
    key: PROMETHEUS_SCRAPE_TOKEN
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 5s
    labels:
      release: kube-prometheus-stack # change to match your Prometheus selector
```

The chart injects the same Secret key into the OpsKnight Deployment and references it from the
`ServiceMonitor`. Render and verify both references before upgrading:

```bash
helm lint helm/opsknight --values values.production.yaml
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml > /tmp/opsknight-rendered.yaml
kubectl apply --dry-run=server -f /tmp/opsknight-rendered.yaml
```

The Prometheus custom resource must select both the `ServiceMonitor` labels and the `opsknight`
namespace. Inspect its `serviceMonitorSelector` and `serviceMonitorNamespaceSelector`; do not assume
every monitor is discovered.

If `networkPolicy.enabled=true`, allow the Prometheus pods or monitoring namespace to reach the
OpsKnight application port. The chart cannot infer the monitoring namespace. Add an explicitly
scoped policy through your platform layer, for example:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: opsknight-from-prometheus
  namespace: opsknight
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: opsknight
      app.kubernetes.io/instance: opsknight
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 3000
```

Adjust release names, labels, namespace, and port to the rendered resources.

## Raw Kubernetes and Kustomize

`k8s/monitoring/servicemonitor.yaml` is optional and is not part of the base kustomization because
clusters without the Prometheus Operator do not have the `ServiceMonitor` CRD.

For an Operator-enabled production overlay:

1. Create an externally managed `opsknight-metrics` Secret containing
   `PROMETHEUS_SCRAPE_TOKEN`.
2. Patch `deployment/opsknight-app` so its `PROMETHEUS_SCRAPE_TOKEN` environment variable reads the
   same Secret key.
3. Add `k8s/monitoring/servicemonitor.yaml` as an overlay resource.
4. Add the labels required by the Prometheus `serviceMonitorSelector`.
5. If NetworkPolicy is enforced, allow ingress from the monitoring namespace or Prometheus pods.

Example Deployment patch:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opsknight-app
  namespace: opsknight
spec:
  template:
    spec:
      containers:
        - name: opsknight
          env:
            - name: PROMETHEUS_SCRAPE_TOKEN
              valueFrom:
                secretKeyRef:
                  name: opsknight-metrics
                  key: PROMETHEUS_SCRAPE_TOKEN
```

Render the overlay and check that `ServiceMonitor.spec.selector.matchLabels` exactly matches the
labels on `service/opsknight-service`:

```bash
kubectl kustomize deploy/overlays/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

## Metric reference and aggregation

OpsKnight metrics have one of three scopes:

- **Counter** metrics are process-local and reset on restart. Use `sum(rate(...))` across replicas.
- **Instance** gauges describe one process. Keep the `instance` or `pod` label when diagnosing a
  replica; use `max` for an installation-level presence signal.
- **Cluster snapshot** gauges query shared database state and are emitted by every replica for
  availability. Use `max without(instance,pod)`, never `sum`, or replica count will multiply the
  value.

| Metric                                                   | Kind and scope         | Labels                            | Meaning                                                  |
| -------------------------------------------------------- | ---------------------- | --------------------------------- | -------------------------------------------------------- |
| `opsknight_http_requests_total`                          | counter                | `method`, `route`, `status_class` | Completed requests by normalized route and status class. |
| `opsknight_http_request_duration_seconds`                | histogram/counter      | `method`, `route`                 | Request latency histogram.                               |
| `opsknight_http_requests_in_flight`                      | gauge/instance         | `route`                           | Requests currently executing in a process.               |
| `opsknight_build_info`                                   | gauge/instance         | `version`                         | Running build identity.                                  |
| `opsknight_active_incidents`                             | gauge/cluster snapshot | none                              | Current active incidents.                                |
| `opsknight_active_users`                                 | gauge/cluster snapshot | none                              | Current active users.                                    |
| `opsknight_job_queue`                                    | gauge/cluster snapshot | `status`                          | Legacy queue count by bounded status.                    |
| `opsknight_jobs_pending`                                 | gauge/cluster snapshot | `type`                            | Pending durable jobs by bounded type.                    |
| `opsknight_jobs_processing`                              | gauge/cluster snapshot | `type`                            | Processing durable jobs by bounded type.                 |
| `opsknight_jobs_oldest_pending_age_seconds`              | gauge/cluster snapshot | `type`                            | Oldest pending job age.                                  |
| `opsknight_notifications_undelivered`                    | gauge/cluster snapshot | none                              | Pending or retryable failed deliveries.                  |
| `opsknight_notifications_oldest_undelivered_age_seconds` | gauge/cluster snapshot | none                              | Oldest undelivered notification age.                     |
| `opsknight_escalations_overdue`                          | gauge/cluster snapshot | none                              | Escalations past their scheduled execution time.         |
| `opsknight_escalation_max_lag_seconds`                   | gauge/cluster snapshot | none                              | Maximum lag among overdue escalations.                   |
| `opsknight_rollup_freshness_age_seconds`                 | gauge/cluster snapshot | none                              | Age of the newest daily analytics rollup.                |
| `opsknight_metrics_collection_errors`                    | gauge/instance         | none                              | Collectors that failed in the current cached snapshot.   |
| `opsknight_metrics_cache_hits_total`                     | counter                | none                              | Process-local exporter cache hits.                       |
| `opsknight_metrics_cache_misses_total`                   | counter                | none                              | Process-local exporter cache misses.                     |
| `opsknight_metrics_cache_age_seconds`                    | gauge/instance         | none                              | Age of the process-local exporter snapshot.              |

Metrics can be absent before a process observes the relevant operation or when their collector is
unavailable. Absence is not the same as zero. The registry forbids identifiers, contact data, URLs,
request IDs, IP addresses, and exception messages as labels to control cardinality and disclosure.

## Recording rules and useful PromQL

The repository ships rules in `monitoring/prometheus/`:

- `opsknight-recording-rules.yaml` safely collapses duplicated cluster-snapshot gauges;
- `opsknight-alerts.yaml` covers collector failure, stale jobs, escalation lag, stale notification
  delivery, rollup freshness, HTTP errors, and HTTP p95 latency.

Mount these files into Prometheus and include them under `rule_files`, or package their `groups`
inside your Prometheus Operator's `PrometheusRule` resource. Validate them before rollout:

```bash
promtool check rules monitoring/prometheus/opsknight-recording-rules.yaml
promtool check rules monitoring/prometheus/opsknight-alerts.yaml
```

Useful queries:

```promql
# Requests per second across all replicas
sum(rate(opsknight_http_requests_total[5m]))

# HTTP 5xx percentage
100 * sum(rate(opsknight_http_requests_total{status_class="5xx"}[5m]))
  / clamp_min(sum(rate(opsknight_http_requests_total[5m])), 0.001)

# Installation-wide p95 request latency
histogram_quantile(
  0.95,
  sum by (le) (rate(opsknight_http_request_duration_seconds_bucket[5m]))
)

# Shared notification backlog without replica multiplication
max without(instance, pod) (opsknight_notifications_undelivered)

# Oldest pending job age by type
max without(instance, pod) (opsknight_jobs_oldest_pending_age_seconds)
```

Use the same expressions in Grafana after adding Prometheus as a data source. Keep `job`, cluster,
namespace, and environment selectors in dashboards when one Prometheus installation scrapes several
OpsKnight deployments.

Tune alert thresholds against normal workload and incident-delivery objectives. Do not route the
only alert for an OpsKnight outage back through the same OpsKnight installation; keep an independent
monitoring and emergency-contact path.

## Token rotation

The exporter accepts one token at a time. Rotate it as a coordinated change:

1. create or update the protected deployment Secret;
2. restart/roll out every OpsKnight replica so it receives the new environment value;
3. update the Prometheus credentials file or Secret and reload/reconcile Prometheus;
4. confirm all targets are `UP` and `opsknight_metrics_collection_errors` is zero; and
5. remove the previous secret version according to the secret manager's policy.

A brief 401 scrape gap is possible because there is no dual-token overlap. Do not weaken endpoint
authentication to avoid that gap.

## Troubleshooting

| Symptom                                     | Likely cause and check                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 401                                    | Token missing from the app, scraper using a different value, malformed `Authorization: Bearer` header, or pods not restarted after Secret rotation. |
| Target is absent                            | Prometheus does not select the `ServiceMonitor` label/namespace, or the monitor selector does not match the Service.                                |
| Target is `DOWN` with timeout               | NetworkPolicy, DNS, Service port name, ingress, TLS, or scrape timeout. Test from the Prometheus pod.                                               |
| Metrics return but some families are absent | No observation exists yet or the corresponding database collector failed. Check `opsknight_metrics_collection_errors` and application logs.         |
| Counts grow with replica count              | A cluster-snapshot gauge was summed. Use `max without(instance,pod)` or the shipped recording rule.                                                 |
| HTTP percentiles are empty                  | The process has not observed traffic yet, the query omitted `_bucket`, or histogram buckets were aggregated without `le`.                           |
| Scrapes increase database load              | Keep the 30-second interval, inspect collector errors/cache misses, and avoid duplicate scrape jobs.                                                |

## Acceptance checklist

- [ ] Every OpsKnight replica receives the same dedicated scrape token from a Secret.
- [ ] Prometheus reads the token from a protected file or Secret and sends Bearer authentication.
- [ ] The target is `UP`; unauthenticated requests return 401.
- [ ] ServiceMonitor label and namespace selectors are verified against the Prometheus resource.
- [ ] NetworkPolicy permits only the intended monitoring source to reach the application port.
- [ ] Cluster-snapshot gauges use `max`, while counters and histograms aggregate across replicas.
- [ ] Recording and alert rules pass `promtool check rules`.
- [ ] Alerts have an independent delivery path for an OpsKnight-wide outage.
- [ ] PostgreSQL, container, ingress/TLS, and backup health are monitored separately.
- [ ] Token rotation and target verification are included in the operations runbook.

## Related topics

- [Monitoring OpsKnight](./monitoring)
- [Configuration reference](../getting-started/configuration)
- [Helm deployment](./helm)
- [Kustomize](./kustomize)
- [Docker Compose](./docker)
- [Metrics architecture contract](../architecture/metrics-observability)
- [Prometheus / Alertmanager integration](../integrations/metrics-alerting/prometheus)
