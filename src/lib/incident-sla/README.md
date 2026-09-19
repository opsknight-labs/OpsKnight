# Incident SLA domain contract

The incident row is the operational source of truth. New incidents resolve the newest sealed policy once, capture its targets and provenance, and never consult mutable configuration again.

Precedence for new incidents is: service priority rule, workspace priority rule, explicit service base, then workspace base. A service policy with `inheritWorkspace=true` inherits the workspace base but may still define service priority rules. Policy drafts are invisible; sealing publishes an immutable version.

Both phases breach only when elapsed time is strictly greater than the target. A source recovery before the ACK deadline makes acknowledgement `NOT_REQUIRED`; source recovery after the deadline and manual or unknown resolution without ACK remain breaches. Snooze and suppression stop the canonical materialized clock; reopening shifts future deadlines by the accumulated pause duration.

All operational consumers must use `projectIncidentSlaState()`, `getIncidentSlaCompliance()`, or `getIncidentSlaTransitions()`. Service fields and legacy priority constants exist only for migration/reporting compatibility and must not drive live incident SLA decisions.

`IncidentSlaPolicy` is the sole authority for new incident response targets. `ServiceObjective` owns uptime, availability, MTTA, MTTR, latency, and future reliability objectives. The legacy definition and snapshot tables are read-only archives; they must never select or mutate an incident's captured response contract. `Service.targetAckMinutes`, `Service.targetResolveMinutes`, and `Service.slaTier` are compatibility/catalog fields. The UI calls `slaTier` “Service Tier” because it is informational and does not control response SLA.
