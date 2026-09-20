# Incident SLA and service-objective boundary

OpsKnight has two deliberately separate reliability domains.

## Incident response SLA

`IncidentSlaPolicy` is the only configuration authority for ACK and resolution
targets. When an incident is created, the selected targets and policy identity
are frozen onto the incident (`slaAckTargetMs`, `slaResolveTargetMs`,
`slaPolicyId`, `slaPolicyVersion`, and `slaPolicyRule`). Every live or historical
classification must use `projectIncidentSlaState()` or its canonical compliance
adapter. Mutable service defaults, `SLADefinition`, and `SLASnapshot` must never
participate in this decision.

This domain owns priority overrides, support-hour pauses, warning and breach
notifications, scheduling, and `IncidentMetricRollup` analytics.

## Service objectives

`ServiceObjective` owns metric objectives such as uptime, availability, MTTA,
MTTR, latency, and future error-rate signals. It explicitly stores the
comparison direction and rolling window. `evaluateServiceObjective()` is the
only evaluation boundary used by APIs and materialized snapshots.

`ServiceObjectiveSnapshot` is metric-neutral. The previous `SLASnapshot` table
is retained as read-only legacy history and is exposed with `legacy: true`.

```text
IncidentSlaPolicy -> frozen Incident contract -> canonical SLA projector
ServiceObjective  -> objective evaluator       -> objective snapshot
```

## Compatibility and removal

Legacy definition GET endpoints remain temporary read adapters and emit
`Deprecation`, `Sunset`, and successor `Link` headers. POST, PATCH, and DELETE
return HTTP 410. Requests increment
`opsknight_legacy_sla_api_requests_total{method,endpoint_family}`. Remove the
adapters and legacy tables only after that metric remains zero throughout the
supported deprecation period and archived history has been exported or accepted
for deletion.
