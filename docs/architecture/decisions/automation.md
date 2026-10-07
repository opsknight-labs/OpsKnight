# Service automation and durable responder routing

Status: accepted for implementation on feat/service-automation.

Evaluation runs inside the existing incident transaction, after classification
and the service/integration dedup advisory lock. All database reads precede the
pure evaluator. Enrichment supplies final priority before immutable SLA capture.
The evaluator performs no database, network, provider, or queue operations.
The benchmark and transaction certification cover extraction and 25/50/100 rules.

PostgreSQL remains the only coordination system. BackgroundJob remains the
durable outbox; automation creates no Redis dependency or message broker.
Concurrent webhook retries use the existing service + dedup serialization and
InboundDelivery fencing. Only the winning new-incident transaction records the
initial decision, trace, and supplemental jobs. Retriggers never reroute.

Automation version pinning uses the active immutable version ID read once in the
transaction. Publishing locks the service, checks draft revision and active
version, compiles and lints, then inserts a version and updates configuration
atomically. Database triggers reject version updates. Rollback publishes a new
version with sourceVersionId. Cache entries are bounded and keyed by version ID.

Selected escalation policy persistence uses IncidentAutomationDecision. A LIVE
decision records the chosen policy ID and name, base/final priority, matched
rule, and a bounded explanation for the incident lifetime. The centralized
resolver applies it to initial, delayed, retry, recovery, resume, reopen, and
manual escalation. Legacy incidents without decisions use service defaults.

NO_ESCALATION is explicit RESPONDER_ROUTE_NONE: no escalation job and no default
personal notification fanout. Service notifications, status pages, webhooks,
war rooms, Jira, and supplemental Slack/Teams remain eligible. This outcome is
authoritative to scanners and workers; it is never represented as missing policy.

Fallback behavior discards all proposed enrichment/routing/actions and uses
existing service behavior on invalid versions, extraction limits, timeout,
rule failure, and missing selected policy. Infrastructure transaction failures
roll back and retry using existing transaction semantics rather than attempting
queries in an aborted PostgreSQL transaction. Supplemental failures retry
independently without changing responder routing.

OPSKNIGHT_AUTOMATION_ENABLED defaults false and has highest priority for new
evaluations. Every service begins DISABLED. SHADOW writes only traces,
aggregates, observations, and metrics: incident fields, SLA, tags, escalation,
and operational outbox are identical to DISABLED. Existing LIVE decisions stay
pinned when configuration changes or evaluation is disabled; changing the
global flag must never silently move a previously chosen responder audience.

Detailed traces retain 90 days by default; decisions last as long as incidents.
Discovery and retention run on the general/maintenance lane. Observations and
traces contain only bounded safe scalar context, never full webhook payloads,
credentials, headers, tokens, signatures, or secrets. Publish and LIVE are admin
capabilities; owned-service responders can edit/test drafts; read access follows
existing service guards. All writes use the existing audit system.

Schema changes are additive. Mixed-version replicas may create incidents
without decisions; new workers interpret those as service-default routing.
Production rollout remains operator-controlled: flag off, then services disabled,
then a non-critical service in SHADOW, reviewed results, then LIVE per service.
