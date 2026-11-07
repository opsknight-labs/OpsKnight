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
  verified_at: 2026-11-07
  evidence:
    [
      src/lib/intelligence/noise-controls,
      tests/unit/intelligence-noise-controls.test.ts,
      tests/integration/intelligence/noise-controls.test.ts,
    ]
---

# Noise controls (pre-paging)

Settings → Intelligence → **Noise controls** decides what happens to an alert _before_ it pages:
maintenance windows, suppression rules, orchestration rules, content dedup, flapping, storm grouping
and heartbeat monitors. Everything starts **OFF**, per service or globally, runs in **SHADOW** first,
and every decision is recorded and reversible. Highest urgency is never held.

## How it is safe

- **Off the hot path by default.** The ingestion hook reads an in-process snapshot refreshed every
  30 seconds and makes at most three index-backed lookups, all under one 5 ms deadline. If the snapshot is
  cold, the deadline passes, or a lookup fails, the event pages exactly as it does today
  (`opsknight_prepaging_fail_open_total{reason}`). There is no model and no network call.
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

## Integration point

The controls are additive: the hook `evaluatePrePagingControls(input, getPrePagingSnapshot(),
prismaLookups(tx))` plus `recordPrePagingDecision(tx, decision, …)` is one call in `processEvent`
before the incident is created, and `decision.apply` tells the caller what to do instead of paging.
Until that call lands (it is wired together with the ingestion-side noise layer), the controls are
evaluated by the simulation and the heartbeat monitors are fully live.
