---
title: Noise controls (pre-paging)
description: Maintenance windows, suppression and orchestration rules, content dedup, flapping, storm grouping and heartbeat monitors, shadow-first and reversible.
type: deployment
product_area: intelligence
audience: [operator, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Configure pre-paging noise controls in shadow, check them against history, then turn them on per service.
verification:
  level: test
  verified_at: 2026-11-10
  evidence:
    [
      src/lib/intelligence/noise-controls,
      src/lib/events.ts,
      tests/unit/intelligence-noise-controls.test.ts,
      tests/integration/intelligence/noise-controls.test.ts,
      tests/integration/intelligence/noise-controls-ingestion.test.ts,
      tests/ingestion/noise-controls-hook.test.ts,
      tests/unit/intelligence-noise-lookup-client.test.ts,
    ]
---

# Noise controls (pre-paging)

Settings → Intelligence → **Noise controls** decides what happens to an alert _before_ it pages:
maintenance windows, suppression rules, orchestration rules, content dedup, flapping, storm grouping
and heartbeat monitors. Everything starts **OFF**, per service or globally, runs in **SHADOW** first,
and every decision is recorded and reversible. Highest urgency is never held.

## How it is safe

- **Off the hot path by default.** With the policy OFF (the default) ingestion only checks the
  in-process snapshot, refreshed in the background every 30 seconds; nothing else runs. In SHADOW or ON
  every read the policy can need (dedup target, flapping history, storm count and parent) is fetched in
  **one** index-backed statement on a small dedicated connection pool (two connections per process,
  using `DIRECT_DATABASE_URL` when set) whose server-side statement timeout equals the shared 5 ms
  deadline, so it never touches the event's own transaction. If the database URL goes through a
  transaction pooler (`pgbouncer=true`), the statement runs inside the event transaction under a
  savepoint with the same timeout instead, which costs a few more round trips. If the snapshot is cold, the deadline
  passes, or a lookup fails (including a missing table), the event pages exactly as it does today
  (`opsknight_prepaging_fail_open_total{reason}`); a slow lookup can hold the event for at most one
  deadline. There is no model and no network call.
- **SHADOW before ON.** In SHADOW the decision is computed and recorded but not applied. ON is refused
  until a week of shadow evidence exists (at least 50 shadow decisions, at most 2% marked wrong), unless
  you tick "I understand" to turn it on anyway.
- **Reversible.** Every decision is listed under _Recent decisions_. Reversing an applied decision
  re-ingests the alert through the normal event path so it pages ("un-group and page"); reversing a shadow
  decision marks it wrong and counts against readiness.
- **HIGH urgency.** Maintenance windows, suppression rules and orchestration apply to every urgency
  (they are explicit operator intent). Content dedup, flapping and storm grouping leave HIGH alone unless
  the policy opts in, and a storm hold is never applied to HIGH.

## Controls

| Control            | What it does                                                                                                                                                                                                                                                                                                        | Default                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Maintenance window | Matching alerts (service, team, label or everything) are stored and visible but never page, or page at a lower urgency. Windows can repeat (`FREQ=WEEKLY;BYDAY=SA,SU`, also `DAILY`/`MONTHLY`, `INTERVAL`, `COUNT`, `UNTIL`) and can be **ended now**.                                                              | —                        |
| Suppression rule   | Matchers on source, summary, severity, resource or a label (`equals`, `contains`, `starts with`, `regex`, `exists`), all must match. Suppress or downgrade; optional expiry; owned and audited. Suggestions come from services whose incidents mostly clear within five minutes (a downgrade, never a suppression). | —                        |
| Orchestration      | Ordered rules on the same matchers with actions `DROP`, `SUPPRESS`, `SET_SEVERITY`, `SET_URGENCY`, `SET_LABEL`, `REROUTE_SERVICE`, `ATTACH_RUNBOOK`, `ADD_NOTE`. Transforms accumulate; the first `DROP`/`SUPPRESS` decides.                                                                                        | none                     |
| Content dedup      | Same content fingerprint as an open incident on the service within the window (and the open incident's labels contain the alert's) → appended as an alert instead of a new incident.                                                                                                                                | off, 15 min              |
| Flapping           | TRIGGERED↔RESOLVED transitions at or above the threshold inside the window, keyed on the dedup key and (optionally) the content fingerprint → created suppressed.                                                                                                                                                   | off, 4 in 3 min          |
| Storm grouping     | At or above N incidents on the service (or its approved dependency neighbourhood) within K seconds → attached under the earliest open incident as a child. Optional bounded hold (≤ 60 s) while a burst is forming; never for HIGH.                                                                                 | off, 10 in 60 s, no hold |
| Heartbeat monitor  | `GET`/`POST /api/heartbeats/<token>`. A missing ping (interval + grace) raises an incident on the service through normal ingestion at the monitor's urgency; the next ping resolves it. A monitor that is never pinged is due from its creation.                                                                    | —                        |

Post-paging correlation also gained two per-rule options: **allowHighUrgency** (HIGH incidents may join
as suggestions, never automatically) and **linkType** `PARENT_CHILD` (members are grouped under the
anchor instead of only linked).

## Versions, history and rollback

The policy for each scope (all services, or one service), orchestration rules included, is versioned the
same way automation rule sets are:

- **Publishing creates an immutable version.** Every save of the policy publishes a new numbered version
  holding the mode and the full definition, with a checksum. Earlier versions are never edited.
- **Decisions name their version.** Each recorded decision stores the version it was evaluated against;
  _Recent decisions_ shows it as `policy vN`.
- **History and diff.** _Policy history_ lists versions newest first, marks the running one, and shows
  what each changed from the version before it (mode, tuning fields, orchestration rules added, removed,
  changed or reordered). Older versions also show what rolling back to them would change.
- **Rollback publishes a copy.** _Roll back to vN_ publishes a clone of version N as the newest version
  (labelled `rollback of vN`), so the history keeps the rollback itself. It uses the same
  compare-and-set as a save, and rolling back to an ON version from SHADOW or OFF needs the same "I
  understand" acknowledgement (or shadow evidence) as switching ON directly.
- **Existing policies.** A policy saved before versioning existed is captured as version 1 (labelled
  `captured from pre-versioning policy`) by the bounded background sweep, or immediately when the scope is
  next published or its history is opened. During a rolling upgrade, a save made by an older replica is
  captured the same way. Until a scope is captured its decisions record no version; evaluation itself is
  unaffected.

## Test before you turn it on

_Test against history_ replays the saved controls over the last N days of alerts, read-only, and reports
what would have been suppressed, grouped, downgraded or held, with examples. The run is recorded as an
evaluation run. Use it with SHADOW to size thresholds, then turn ON per service.

## KPIs and alerts

The page shows alerts per incident (compression), pages avoided (applied) and what SHADOW would have
avoided, downgrades and holds, the false-group rate (reversed over applied groupings) and heartbeat
state. Metrics: `opsknight_prepaging_decisions_total{control,action,mode}`,
`opsknight_prepaging_fail_open_total{reason}`, `opsknight_prepaging_evaluation_seconds`,
`opsknight_heartbeat_monitors_missing`, `opsknight_heartbeat_pings_total{outcome}`.

## What ON does to an alert

The hook runs in `processEvent` for a new trigger (no open incident with the same dedup key), inside the
event transaction and before the incident is written. Re-triggers of an open incident, resolves,
acknowledgements, legacy flapping suppression and operator reversals are never evaluated. In SHADOW
the decision is recorded against the alert and the incident it created, and everything pages as
before. In ON:

| Decision                                         | What happens                                                                                                                                                                                                                                                                                                                                                                                                                          | Reverse it                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Suppress (window, rule, orchestration, flapping) | The incident is created **SUPPRESSED** with the alert attached: visible, SLA paused, no escalation and no notifications. Its first timeline entry names the control and the reason.                                                                                                                                                                                                                                                   | Re-ingests the alert as a new incident that pages.                |
| Downgrade (window, rule)                         | The incident is created and pages at the lower urgency; the timeline says from what to what and why.                                                                                                                                                                                                                                                                                                                                  | Marks the decision wrong (the incident already paged).            |
| Drop (orchestration)                             | No incident. The alert is stored unlinked so the decision can be reviewed.                                                                                                                                                                                                                                                                                                                                                            | Re-ingests the alert as a new incident that pages.                |
| Transform (orchestration)                        | Severity and labels are restated on the stored alert, urgency is applied to the incident, notes become timeline entries. **Reroute** and **attach runbook** are recorded on the decision and noted on the timeline but not applied at ingestion.                                                                                                                                                                                      | Marks the decision wrong.                                         |
| Append (content dedup)                           | The alert is attached to the open incident with the same content, like a re-trigger: urgency only ever rises, and the open incident's timeline explains the append.                                                                                                                                                                                                                                                                   | Re-ingests the alert as its own incident that pages.              |
| Group (storm)                                    | A child incident is created OPEN under the earliest open incident of the storm (accepted `PARENT_CHILD` relationship), with no escalation of its own. Its service-channel and webhook posts go through the notification noise controller keyed on the parent: the parent's post (or one grouped post when the parent posted more than a minute ago) stands for the storm, the rest are recorded as skipped. **The storm pages once.** | Re-ingests the alert as its own incident that pages.              |
| Hold (storm, ≤ 60 s)                             | The incident is created OPEN and its first page is scheduled for the end of the hold; if it is acknowledged or resolved meanwhile it never pages. **HIGH urgency is never held**, even when the policy opts HIGH in.                                                                                                                                                                                                                  | Re-ingests the alert so it pages now (the held page still fires). |

If an append or group target closed between the lookup and the write, the event pages normally.

## Capacity note

Each SHADOW/ON evaluation adds one database round trip on the lookup pool (about 1 ms per event in local
measurements), and each process that ingests keeps two extra database connections open once any service
is in SHADOW or ON; count them in your connection budget. During a burst, or on a busy host, the 5 ms
budget can be exhausted, in which case the event pages normally and
`opsknight_prepaging_fail_open_total{reason="deadline"}` rises; watch that counter after switching a
service to SHADOW. Local measurements (`plans/intelligence-engine/certification/perf/README.md`) meet
the ingestion latency contract for the controls alone but not yet with the intelligence lane busy in the
same process or during a 10,000-event burst, so treat ON as opt-in per service and keep it to services
where the noise justifies the cost.

## Integration point

`processEvent` reaches the controls only through `src/lib/intelligence/ingest-hooks.ts`
(`evaluateIngestNoiseControls`, `recordIngestNoiseDecision`, `linkStormChild`); the architecture test
keeps that surface, the lookup pool's deadline-sized timeouts, the savepoint fallback and the reversal
bypass in place.
