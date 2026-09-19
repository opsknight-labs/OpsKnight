# SLA-to-service-objective migration inventory

| Component                    | Current use                                               | Future state                              |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `IncidentSlaPolicy`          | Production incident response SLA                          | Keep; sole policy authority               |
| Frozen incident SLA fields   | Immutable incident contract                               | Keep                                      |
| `projectIncidentSlaState()`  | Canonical SLA semantics                                   | Keep                                      |
| `IncidentMetricRollup`       | Historical incident SLA analytics                         | Keep; sole materialized source            |
| `SLADefinition`              | Legacy generic objectives and old ACK/resolve definitions | Read-only archive                         |
| `SLASnapshot`                | Legacy daily ACK/resolve snapshots                        | Read-only archive                         |
| `processSLASnapshots()`      | Compatibility job entry point                             | Disabled no-op; remove after caller audit |
| `generateDailySnapshot()`    | Legacy snapshot writer                                    | Disabled; remove after caller audit       |
| `/api/sla-definitions`       | Legacy objective API                                      | Deprecated GET adapter; writes return 410 |
| `/api/sla/compliance`        | Legacy compliance API                                     | Deprecated adapter to canonical evaluator |
| `ServiceObjective`           | Metric-neutral objective definition                       | Canonical SLO definition                  |
| `ServiceObjectiveSnapshot`   | Metric-neutral historical values                          | Canonical SLO history                     |
| `/api/v1/service-objectives` | Not previously present                                    | Canonical CRUD/evaluation/history API     |

## In-repository scheduler audit

Searches cover worker bootstrap code, `.github`, Kubernetes manifests, Helm,
Docker Compose, Terraform-shaped files, deployment documentation, and scripts.
No in-repository caller of `processSLASnapshots()` or `generateDailySnapshot()`
exists outside their implementation and tests. External customer schedulers
cannot be proven from source control; the compatibility job therefore remains a
logged no-op for one release.

## Data migration

The additive migration copies only rows whose metric type is a supported generic
objective and which do not carry legacy ACK/resolve targets. Comparator direction
is explicit: uptime and availability use `>=`; MTTA, MTTR, and P99 latency use
`<=`. Incident-only definitions remain in the legacy table and are never
invented as service objectives.

Historical `SLASnapshot` rows remain untouched and read-only. The history API
returns them separately with `legacy: true`; it does not reinterpret their ACK
and resolve counters as generic objective samples.

## Rollout gates

1. Deploy additive tables, backfill, disabled legacy writer, and adapters.
2. Confirm objective counts and evaluation parity in staging.
3. Remove external legacy scheduler invocations.
4. Monitor legacy API traffic for the supported deprecation period.
5. Export legacy history if retention requires it.
6. In a later migration, remove compatibility code and tables only after steps
   3–5 are complete. These time-based production gates cannot be asserted by a
   code change alone.
