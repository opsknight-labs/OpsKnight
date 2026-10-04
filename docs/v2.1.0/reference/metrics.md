---
title: Metrics reference
description: Metric types, labels, scope, aggregation, and alerting guidance for the OpsKnight Prometheus endpoint.
type: reference
product_area: observability
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/metrics/route.ts, src/lib/metrics/operational/registry.ts, tests/api/metrics.test.ts]
---

# Metrics reference

`GET /api/metrics` exposes Prometheus text format after Admin-session or Bearer-token authentication. See [Scrape OpsKnight with Prometheus](../operate/reliability/prometheus/) for setup and security.

Every emitted family includes `# HELP` and `# TYPE`. Labels are deliberately bounded: incident, user, service, team, request, email, phone, IP, and other high-cardinality identifiers are forbidden by the registry.

## Scope and aggregation

- `cluster_snapshot`: a database-derived current value. When every web replica scrapes the same database, do not sum replicas; use one scrape target or `max without(instance)`.
- `instance`: state held by one process. Preserve `instance`; sum only when a cluster total is meaningful.
- `counter`: monotonic process counter. Use `rate()` or `increase()` and normally sum across instances by the documented bounded labels.
- `histogram`: use `_bucket`, `_sum`, and `_count`; aggregate buckets by `le` before `histogram_quantile`.

## Core platform and queue metrics

| Metric | Type | Labels | Scope | Meaning and use |
|---|---|---|---|---|
| `opsknight_build_info` | gauge | `version` | instance | Value 1 for the running build; alert when unexpected versions coexist after a rollout. |
| `opsknight_active_incidents` | gauge | — | cluster snapshot | Current active incident count; do not sum replicas. |
| `opsknight_active_users` | gauge | — | cluster snapshot | Current active account count; capacity context, not login activity. |
| `opsknight_job_queue` | gauge | `status` | cluster snapshot | Legacy durable-job count grouped by bounded status. |
| `opsknight_jobs_pending` | gauge | `type` | cluster snapshot | Pending durable work by job type. Alert on sustained growth. |
| `opsknight_jobs_processing` | gauge | `type` | cluster snapshot | Work currently processing by type. Compare with worker availability. |
| `opsknight_jobs_oldest_pending_age_seconds` | gauge | `type` | cluster snapshot | Age of the oldest pending job. This is usually a stronger paging signal than depth alone. |
| `opsknight_notifications_undelivered` | gauge | — | cluster snapshot | Pending plus retryable failed notification records. |
| `opsknight_notifications_oldest_undelivered_age_seconds` | gauge | — | cluster snapshot | Age of the oldest undelivered notification. Alert against the delivery objective. |
| `opsknight_escalations_overdue` | gauge | — | cluster snapshot | Incidents whose next escalation execution is overdue. |
| `opsknight_escalation_max_lag_seconds` | gauge | — | cluster snapshot | Largest current escalation delay. Treat sustained non-zero lag as paging-path risk. |
| `opsknight_rollup_freshness_age_seconds` | gauge | — | cluster snapshot | Age of the newest daily analytics rollup update. |

## HTTP and collection metrics

| Metric | Type | Labels | Scope | Meaning and use |
|---|---|---|---|---|
| `opsknight_http_requests_total` | counter | `method`, `route`, `status_class` | counter | Completed requests on normalized routes. Use a rate grouped by status class. |
| `opsknight_http_request_duration_seconds` | histogram | `method`, `route` | counter | Request latency. Aggregate buckets across instances before calculating quantiles. |
| `opsknight_http_requests_in_flight` | gauge | `route` | instance | Requests currently executing on one instance. |
| `opsknight_metrics_collection_errors` | gauge | — | instance | Number of collectors that failed in the current cached snapshot; alert when greater than zero. |
| `opsknight_metrics_cache_hits_total` | counter | — | counter | Metrics snapshot cache hits. |
| `opsknight_metrics_cache_misses_total` | counter | — | counter | Metrics snapshot cache misses. |
| `opsknight_metrics_cache_age_seconds` | gauge | — | instance | Age of the process-local snapshot; normal cache is 10 seconds and degraded cache is 60 seconds. |

## Integration and provider metrics

| Metric | Type | Labels | Scope | Meaning and use |
|---|---|---|---|---|
| `opsknight_external_operations` | gauge | `status` | cluster snapshot | Durable outbound/external work grouped by status. |
| `opsknight_chatops_intents` | gauge | `status` | cluster snapshot | Durable ChatOps intents grouped by status. |
| `opsknight_inbound_deliveries` | gauge | `status` | cluster snapshot | Durable inbound-provider deliveries grouped by status. |
| `opsknight_provider_cooldown` | gauge | `provider` | cluster snapshot | 1 when a provider key class has active distributed cooldowns. |
| `opsknight_integration_reconciliations_total` | counter | `kind` | counter | Expired or ambiguous integration work reclaimed. |
| `opsknight_provider_rate_limits_total` | counter | `provider` | counter | Provider rate-limit responses observed by ChatOps/collaboration paths. |
| `opsknight_provider_permission_failures_total` | counter | `provider` | counter | Provider permission failures. |
| `opsknight_notification_provider_429_total` | counter | `provider` | counter | Notification delivery attempts rejected with provider throttling. |
| `opsknight_notification_queue_depth` | gauge | `traffic_class`, `provider`, `channel` | cluster snapshot | Ready notification work by bounded delivery dimensions. |
| `opsknight_notification_oldest_age_seconds` | gauge | `traffic_class` | cluster snapshot | Oldest ready notification by traffic class. |
| `opsknight_notification_throughput_per_second` | counter | `provider`, `traffic_class` | counter | Provider acceptances; despite the name, apply `rate()` to the counter. |
| `opsknight_notification_effective_rate` | gauge | `provider`, `channel` | instance | Current adaptive delivery rate on an instance. |
| `opsknight_notification_admission_deferred_total` | counter | `reason`, `traffic_class` | counter | Work deferred by provider admission control. |

## ChatOps, war-room, and meeting families

ChatOps counters use bounded `provider`, `verb`, and/or `result` labels:

- `opsknight_chatops_invokes_total`
- `opsknight_chatops_identity_resolution_total`
- `opsknight_chatops_authorization_denied_total`
- `opsknight_chatops_duplicate_total`
- `opsknight_chatops_refresh_total`
- `opsknight_chatops_action_latency_seconds` (histogram by `provider`)

War-room gauges are `opsknight_war_room_health`, `opsknight_war_room_state`, `opsknight_war_room_projection_lag_seconds`, `opsknight_war_room_participant_drift`, and `opsknight_external_cleanup_pending`. Counters are `opsknight_war_room_participant_sync_total`, `opsknight_war_room_reconciliation_total`, `opsknight_war_room_ambiguous_card_abandon_total`, and `opsknight_war_room_projection_total`.

Meeting gauges are `opsknight_meeting_state`, `opsknight_meeting_health`, and `opsknight_meeting_cleanup_pending`. Provision, close, retry, and reconciliation use `opsknight_meeting_provision_total`, `opsknight_meeting_close_total`, `opsknight_meeting_retry_total`, and `opsknight_meeting_reconciliation_total`; provision/close duration families are histograms.

## Realtime, status-page, and fanout families

- Realtime instance state: `opsknight_realtime_subscribers{stream}`, `opsknight_realtime_observed_generation`, `opsknight_realtime_change_age_seconds`, and counter `opsknight_realtime_clock_errors_total`.
- Snapshot health: `opsknight_status_page_snapshot_dirty`, `opsknight_status_page_snapshot_oldest_age_seconds`, `opsknight_status_page_snapshot_bytes`, and `opsknight_status_snapshot_revision_lag`.
- Publication health: `opsknight_status_page_publication_failed`, `opsknight_status_page_fail_closed`, plus publication duration/attempt counters labelled by bounded change class and outcome.
- Fanout: `opsknight_status_page_fanout_total`, `opsknight_status_fanout_campaign_total`, `opsknight_status_fanout_materialized`, and `opsknight_status_fanout_failed`.
- Serving: `opsknight_status_serving_store_latency_seconds`, `opsknight_status_serving_store_errors_total`, `opsknight_status_page_stale_serves_total`, and `opsknight_status_page_revocations_total`.

## SLA, response-policy, and compliance families

SLA scheduler state is exposed through `opsknight_sla_scheduler_mode{mode}` (one active series has value 1), `opsknight_sla_scheduler_null_hints`, `opsknight_sla_scheduler_due`, `opsknight_sla_scheduler_shadow_mismatch_total`, `opsknight_sla_scheduler_config_read_failures_total`, `opsknight_sla_hint_repairs_total`, and histogram `opsknight_sla_transition_lag_seconds{kind}`.

Response-policy/classification counters include `opsknight_incident_classification_total`, `opsknight_response_policy_conflicts_total`, `opsknight_response_policy_resolution_errors_total`, `opsknight_incident_resolution_unknown_total`, `opsknight_sla_projection_invalid_total`, `opsknight_engagement_deferred_total`, and `opsknight_response_policy_restore_total`.

Compliance exposes monitor/evaluation/drift counters, `opsknight_compliance_drift_open{kind}`, histogram `opsknight_compliance_drift_projection_lag_seconds`, and `opsknight_compliance_monitor_last_success_unixtime`. Alert on an old last-success timestamp together with failed monitor runs; a zero open-drift gauge alone does not prove the monitor is running.

## Example PromQL

```promql
# HTTP 5xx rate by route
sum by (route) (rate(opsknight_http_requests_total{status_class="5xx"}[5m]))

# Oldest critical notification work
max(opsknight_notification_oldest_age_seconds{traffic_class="critical"})

# p95 request latency across replicas
histogram_quantile(0.95,
  sum by (le, route) (rate(opsknight_http_request_duration_seconds_bucket[5m])))

# Any failed collector
max(opsknight_metrics_collection_errors) > 0

# Cluster escalation lag without double-counting replicas
max without(instance) (opsknight_escalation_max_lag_seconds)
```

Some runtime series appear only after the associated code path has executed. Absence is therefore not always zero. Use `opsknight_metrics_collection_errors`, cache age, build information, and scrape health when interpreting a missing family.
