# OpsKnight Intelligence (AIOps)

OpsKnight Intelligence learns from incident history to help responders. It surfaces
**similar past incidents, causes, runbooks and related incidents**. It is disabled by default, configured entirely from
**Settings → Intelligence**, and runs entirely off the paging path.

This document is the architecture and safety contract. Implementation lives in
`src/lib/intelligence/`.

## Safety contract

1. **Analysis is outside the paging transaction.** Ingestion stores bounded common alert metadata
   (severity, normalized resource, credential-filtered labels and template hash), then schedules a
   non-awaited wake hint after the source and paging outbox commit. It never writes derived
   Intelligence records inside that transaction. A keyset discovery watermark with a 30-second
   safety lag and bounded reconciliation repair missed hints. Architecture checks restrict the
   ingestion boundary to the dedicated post-commit facade.
2. **Intelligence never changes routing, paging, escalation or notifications.** Today it only
   reads incidents and writes derived records and reversible relationships. Confirmed Squire actions
   call existing permission-checked application commands; only the confirmation executor may do so.
3. **Off means off.** The master switch and per-policy mode (`OFF`, `SHADOW`, `SUGGEST`, `AUTO`) gate analysis. `SHADOW` records
   without surfacing suggestions. Service-scoped `AUTO` requires a recent passing quality certification;
   it adds reversible relationships after initial paging. Global AUTO remains unavailable. Accepted
   relationships remain visible for undo even after intelligence is disabled.
4. **No environment variables.** All settings are database-backed, revision-locked and audited. An
   architecture test fails if the module reads `process.env`.
5. **Fail safe.** Every cycle is contained: a failing handler, probe or database error degrades
   intelligence and never propagates.
6. **A suggestion cannot leak an incident.** Every suggested precedent is filtered through the same
   incident visibility rule as the rest of the application, and stored evidence contains only
   numeric scores, never text from another incident.

## How it works

```
Incident + alert + paging outbox commit
                 │ post-commit batched wake hint (polling fallback)
                               ▼
        discovery sweep  ── keyset watermark + 30s lag, 500-row repair pages
                               ▼
   IntelligenceWorkItem  ── coalesced: one row per (kind, incident), generation counting
                               ▼
   INDEX_INCIDENT → fingerprint (masked title, tokens, credential-filtered labels)
                               ▼
   ANALYZE_INCIDENT → bounded retrieval → explainable re-rank → fenced findings
                               ▼
   Incident page card (SUGGEST only) · Settings → Intelligence
```

- **Coalescing.** An alert storm produces one unit of work per incident, not one per alert.
  Claims use `FOR UPDATE SKIP LOCKED` with leases, so any number of workers can run. A crashed
  worker's items are re-claimed after the lease expires; its late completion is rejected by the
  claim token. Work signalled while an item runs is kept and run again.
- **Retries and quarantine.** Exponential backoff with jitter; items that exhaust their attempts
  become visible dead letters that an administrator can retry from the settings page.
- **Anti-entropy.** A periodic sweep re-signals recent incidents that were never fingerprinted or
  were resolved after indexing. All intelligence data is derived and can be rebuilt.
- **Hosting.** Split Compose and Helm use a dedicated `intelligence-worker` and Prisma pool.
  Integrated and general-worker roles remain supported, with a settings warning when shared with
  paging work. A disabled install polls slowly; due privacy retention still runs.
- **Incremental alerts.** `IncidentFingerprint` stores creation/edit cursors, an ordered alert
  digest and a label union. Normal appends read and hash only new payloads. ORM edits to older alerts
  use the edit cursor; exceptional ordering/deletion repairs use cached alert fingerprints. Count
  mismatches, explicit force and normalization changes can rebuild from source. Ingestion never
  writes `AlertFingerprint`. Common metadata on existing alerts has a bounded, resumable backfill.

### Similarity

Candidates come from three bounded sources: recent incidents of the same service, full-text
matches, and trigram matches when `pg_trgm` is installed. Full-text search is built into
PostgreSQL, so a managed database without extension rights simply uses the full-text tier; the
Settings page shows which tier is active. Candidates are re-ranked in TypeScript from named
components (wording, labels, service, recency, outcome). Service, recency and outcome can never
create a match by themselves, and the match percentage is a ranking signal, **not a probability**.

## Backpressure and budgets

- **Paging first.** The lane pauses while the oldest due `ESCALATION` or `NOTIFICATION` job has
  waited longer than the configured threshold (including scheduled-task notification delivery), and resumes only below half of it.
- **Time budgets.** Every work item has a wall-clock budget; every intelligence transaction sets a
  statement and lock timeout. Work that exceeds its budget is stopped and retried with backoff.
- **Bounded concurrency, batch size and candidate counts** are all settings with enforced limits.
- **Its own process in `integrated`.** A single-node `integrated` process runs the lane in a forked
  child process (`src/lib/intelligence/jobs/lane-thread.ts`; status, metrics and settings still call it
  the "lane thread"), with its own V8 heap, event loop and Prisma client. Measured, the lane's cost to ingestion in the same thread was not its JavaScript
  (3.5 to 5 ms of CPU per burst) but what it shared with `processEvent`: Prisma response parsing,
  allocation and the garbage-collection pauses they cause, which stop every in-flight event. In its
  own process none of that lands on ingestion. It is a process and not a `worker_threads` Worker
  because Prisma's library query engine calls back into the JavaScript environment that created the
  client: a worker thread that ends (terminated, an uncaught error, out of memory) while its client has
  queries or a transaction in flight aborts the whole process with SIGSEGV/SIGABRT, even after
  `$disconnect()` (reproduced on Prisma 5.22 in 5 of 5 runs per scenario). A child process can die in
  every one of those ways, 20 of 20 runs each, without touching its parent. The cost is a second Node
  process (its own resident memory, roughly that of a small Node service plus a Prisma engine) while
  intelligence is enabled. The process runs the same lane (wake listener, scheduler,
  abortable budgets, generation fencing, quarantine, kind breaker, backpressure). Its whole Prisma
  client is the lane's pool (`application_name` `opsknight-intelligence-lane`, size
  `INTELLIGENCE_LANE_DATABASE_POOL_SIZE`, default 10), so the lane never takes an ingestion connection.
  `processEvent`'s activity count is sent to the process over IPC (at once when a burst starts,
  otherwise coalesced to at most one message per 10 ms; epoch clock), so it yields to ingestion as
  below, and the host sends the ingestion pool's waiting-query count once a second while a lane process
  exists, so the pool-pressure pause still protects that pool. The process reports its status and metrics at most once a second (`getIntelligenceLaneStatus()` and `/metrics`
  are unchanged; the status gains a `thread` block). A thread that exits unexpectedly is restarted
  with backoff (1 s doubling to 60 s, reset after five minutes of running), health is degraded until
  it runs again, and work it had claimed is re-claimed after its lease. Stopping asks the thread to
  stop its lane (aborting pauses, waiting for the in-flight cycle) and disconnect, and kills it after
  30 s. A lane process exits when its parent's IPC channel closes, so it never outlives the server.
  `worker`, `general-worker` and the dedicated `intelligence-worker` role are unchanged.
- **The lane process exists only while intelligence is enabled.** `instrumentation.ts` starts the host with a
  stand-in (`jobs/lane-stand-in.ts`): while settings say disabled, the ordinary lane idles on the main
  thread as it did before the thread existed (one settings row per poll on the process pool, the
  disabled-time sweeps), so a disabled install carries no second heap, Prisma engine or lane
  connection. The stand-in never works enabled: the first cycle that reads settings as enabled calls
  `LaneHost.handOffWhenEnabled`, the host stops the stand-in and starts the thread. A thread that
  reports a `disabled` cycle is stopped and the lane is parked again (`thread.state` `parked`, health
  `disabled`). Totals carry across both moves.
- **Bundle build path.** The thread entry (`jobs/lane-thread-entry.ts`) is bundled to
  `scripts/dist/intelligence-lane-thread.cjs` by `scripts/build-intelligence-lane-thread.mjs`. Every
  build or start from source produces it: `npm run build` (`postbuild`), `npm start` and
  `npm run start:prod` (`prestart`, rebuilt on every start so pulled code never runs an older lane,
  never failing the start) and
  `npm run build:scripts` (the Dockerfile, unchanged). The host looks for it under the working
  directory (dev, `next start`, the Docker image) and, when the working directory is
  `<root>/.next/standalone` (a standalone start from a checkout), under `<root>`.
- **The in-process fallback is explicit.** If the bundle is missing or `INTELLIGENCE_LANE_THREAD=off`,
  an `integrated` lane runs on the main thread beside ingestion. That configuration is outside the
  ingestion contract (see the perf README for its measurements). Startup decides the mode once
  (`planIntegratedLane`), logs one warning with the reason and the remedy, and records it
  (`setIntelligenceLaneMode`): `getIntelligenceLaneStatus()` carries `mode` and `fallbackReason`, lane
  health is `degraded` with a fixed reason once the lane is enabled, and `/metrics` exposes
  `opsknight_intelligence_lane_mode{mode="thread"|"in-process"}` and
  `opsknight_intelligence_lane_thread_fallback` (1 only for an `integrated` fallback; worker roles are
  in-process by design and report 0).
- **Its own pool in a shared process.** In `integrated`, `worker` and `general-worker` processes an
  enabled lane runs its database work on a separate small Prisma pool (`application_name`
  `opsknight-intelligence-lane`, at most `INTELLIGENCE_LANE_DATABASE_POOL_SIZE` connections, default
  10, opened only as needed), so an analysis transaction never holds a connection `processEvent` is
  queueing for. Handler concurrency stays two below that size. `INTELLIGENCE_LANE_DATABASE_POOL_SIZE=0`
  restores the shared pool. The pool-pressure pause still watches the process pool. The dedicated
  `intelligence-worker` role keeps its single pool.
- **Yielding to in-process ingestion.** `processEvent` keeps an in-process count of events in flight
  (two clock reads per event, no I/O). The lane starts yielding at once when two or more events are in
  flight (the start of a burst), and otherwise when the average over at least 50 ms reaches one event.
  The immediate trigger exists because the averaged signal alone engaged only after the first sample
  window that covered the burst, so a cycle that started with the burst ran at full concurrency through
  its first ~200 ms, which is where the remaining p99 cost of the lane thread sat. While yielding, the
  lane runs one item per cycle and pauses after each item and cycle so it is active for at most 20% of
  wall time (pauses capped at 1 s). It returns to full speed only after the load has stayed below 0.25
  for one second. It never stops completely, and it holds no claim, transaction or connection while
  paused (claims it already holds are renewed before they run). Nothing is ingested in a dedicated
  `intelligence-worker`, so it never yields there. `getIntelligenceLaneStatus().yieldingToIngestion`
  shows the state.

## Data and retention

New tables are listed in the personal-data registry and processing inventory (an architecture test
requires every intelligence table to be registered). Retention is configured per entity in
Settings and enforced by a bounded sweep every 15 minutes, **even while intelligence is
disabled**. Incident-linked rows also cascade away with their incident.

Policy versions, correlation decision events and relationship events are append-only at the
database level. Rolling back a policy publishes a **new** version cloned from the old one, so
past decisions always reference the exact version that made them.

## Permissions

| Capability                      | Granted to                | Purpose                                                                          |
| :------------------------------ | :------------------------ | :------------------------------------------------------------------------------- |
| `intelligence.suggestions.read` | every role                | See suggestions on incidents (visibility-filtered)                               |
| `intelligence.read`             | admin, responder, auditor | View the Settings → Intelligence page                                            |
| `intelligence.feedback`         | every role except auditor | Rate suggestions (visibility-checked, rate-limited, one live verdict per person) |
| `intelligence.manage`           | admin                     | Change settings and policies                                                     |

## Settings information architecture

Settings → Intelligence is a first-class tab of `SettingsTopNav` (roles holding `intelligence.read`) and
keeps its card under Workspace & Governance. It has five group pages, each one server-rendered page of
anchored sections. `src/lib/intelligence/settings/routes.ts` is the single source of truth: the
sub-navigation (`IntelligenceSubNav`), the "on this page" links (`IntelligenceGroupHeader`), the
redirects and the links other surfaces use all read it.

| Group              | Route                                   | Sections (anchor ids)                                                                                                    |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Engine             | `/settings/intelligence`                | `lane-health`, `general`, `global-policy`, `triage`, `correlation-rules`, `failed-work`                                  |
| Noise controls     | `/settings/intelligence/noise-controls` | `policy`, `suppression-rules`, `maintenance-windows`, `policy-history`, `heartbeats`, `simulation`, `decisions`          |
| Services & changes | `/settings/intelligence/services`       | `service-policies`, `dependencies`, `topology-sources`, `metric-evidence`, `change-sources`, `alert-quality`             |
| Assistant          | `/settings/intelligence/ai`             | `assistant`, `providers`, `model-routing`, `prompts`, `checks`, `connections`, `knowledge-memory`, `proactive`           |
| Evaluation & spend | `/settings/intelligence/evaluation`     | `grouping-quality`, `answer-feedback`, `insights`, `learned-weights`, `digest`, `usage`, `ai-spend` (and `model-prices`) |

- **Composition.** A group page checks `intelligence.read` once and renders sibling async server
  components from `src/app/(app)/settings/intelligence/_sections/`. Each section loads its own data with
  the same bounds and `*ReadWhere` scoping it had as a page, and catches its own failures, so one failed
  probe leaves one card saying so. A section that has nothing to show for the viewer (failed work when
  nothing failed, learned weights for a non-manager) is not rendered and gets no "on this page" link.
- **Server actions did not move.** They stay in the `actions.ts` files next to the earlier routes
  (`response/`, `insights/`, `quality/`, `connections/`, `ai/memory/`) and revalidate the group page that
  now renders their forms.
- **Redirects.** `LEGACY_INTELLIGENCE_ROUTES` maps each earlier route to its group and section; the
  earlier route's `page.tsx` calls `redirect()` with the query string preserved. `/settings/intelligence/ai`
  additionally redirects to Evaluation & spend when it carries the `spend` period parameter.
  `tests/unit/intelligence-settings-routes.test.ts` asserts that every earlier route redirects to a page
  and section that exist, that every advertised section id is rendered, and that no link in `src/` points
  at a route that only redirects or at an unknown section.
- **One home per fact.** Alert quality is rendered only by `DependenciesChangesSections`
  (`#alert-quality`). Triage is its own card: `publishTriagePolicy` publishes a version that changes only
  `triage.enabled`, and `publishGlobalPolicy` carries the stored triage value over instead of reading a
  checkbox. Suggested grouping rules sit under correlation rules on the Engine page. Usage, spend, budgets
  and model prices are on Evaluation & spend.

## Measuring the cost to ingestion

`tests/load/intelligence-ingestion-ab.ts` is a controlled A/B benchmark. Both arms run the real
`processEvent` path against the same seeded database; they differ only in whether the lane is
enabled and busy in the same process and connection pool (the worst case for contention). Arms
alternate order every repetition, results are paired by repetition so machine drift cancels out,
and each metric is judged against the **measured run-to-run noise** of the baseline using a
bootstrap confidence interval. It refuses to give a verdict from fewer than five repetitions and
reports `NO_DETECTABLE_DIFFERENCE` rather than "equal".

```bash
LOG_LEVEL=error DATABASE_URL=postgresql://.../opsknight_bench \
  npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
  tests/load/intelligence-ingestion-ab.ts --repetitions 8 --events 1500 --concurrency 12 --backlog 4000
```

Each timed burst also records attribution data: event-loop delay and utilisation, process CPU,
garbage-collection pauses, Prisma pool wait on the ingestion pool, engine-timed ingestion statements
per event and sampled PostgreSQL wait events. The report records host load and the lane's pool plan.
`--lane-mode thread` (the default) runs the candidate's lane in its own process through the production
host, as `integrated` does; `--lane-mode in-process` runs it on the ingestion thread (the fallback
configuration, measured separately and outside the contract). The storm drain takes the same flag
(default `in-process`).

The candidate is a **yielding** lane: during a burst the production lane backs off to one item at a
time at a bounded duty cycle, so the gate measures ingestion beside a lane that backs off, not beside
one at full speed. "Lane busy" therefore means lane handlers ran **inside** the timed burst (the union
of handler spans clipped to the burst is above zero in every candidate run); the report gives that
share of burst wall time per run (`laneBusyFractionOfBurst`).

A run is judged only on a quiet host. The script samples the host from a worker thread every 3 s and
marks the run `INVALID` (exit code 2, never a pass or a fail) unless the 1-minute load was below 4 at
the start and never rose above 4 at any sample, no other heavy process (compiler, test runner, build,
another load test, headless browser) was seen, and no gap between samples exceeded 15 s. The
benchmark's own work counts toward that peak (about 0.3 to 1.2 on an 8-core laptop), so start it well
below the limit. `--wait-for-quiet-ms <ms>` waits for a quiet host before the first arm. Invalid runs are discarded and repeated, never averaged in.
`--cpu-profile-dir <dir>` writes a V8 profile of each timed burst, and `--no-lane-yield --no-gate`
measures the lane without yielding (diagnosis only). The attribution behind the lane pool and the
ingestion yield is in `plans/intelligence-engine/certification/perf/ingestion-p50-diagnosis-2026-11-09.md`.

The database name must end in `_bench` or `_test` (the script truncates incident data). Results
from a shared or loaded host are indicative only; the confidence intervals on tail latency are wide
when the baseline is noisy. Formal certification should run on dedicated hardware.

## Correlation (shadow and suggest)

Operators author deterministic rules in a policy (`CONTENT_TEMPLATE`, `EXACT_FIELD`, `LABEL_SET`).
Incidents that produce the same signature inside the same window correlate. Nothing is learned
or probabilistic, and every match is explained by the rule that made it.

- **Reversible, non-destructive.** Correlation never merges incidents, resolves anything, or moves
  alerts. It writes only to its own tables: a group, a member per incident, and (in `SUGGEST`) a
  `RELATED` link from each member to the group's anchor. Reversal is a new decision event.
- **Scope-aware identity.** A group is unique on `(policy, policy version, rule, service scope,
signature, window start)` and is created with `INSERT … ON CONFLICT DO NOTHING`, so any number of
  concurrent workers produce exactly one group; the anchor is elected by compare-and-set. A new
  policy definition creates a new identity space. Compatible service topology overrides may share a group
  when their immutable definitions and active scope match.
- **Windows.** A window is derived from the incident's own time (replays are deterministic), slides
  while incidents keep arriving, and never passes its hard ceiling. Template and label rules are scoped to one service; topology rules use an active dependency component.
- **Critical alerts are never grouped.** Highest-urgency incidents are skipped entirely.
- **Modes.** `SHADOW` records only; `SUGGEST` also proposes links. Correlation work is chained only
  when the effective policy has enabled rules, so installs without rules pay nothing.

### Rules builder and replay preview

Administrators author rules in **Settings → Intelligence → Correlation rules**. Before publishing,
**Preview** replays the edited rules over recent history (bounded by the configured lookback, 90 days,
and a hard 5,000-incident cap) and reports how many incidents would group, how many links would be
proposed, and how many critical incidents are excluded. The replay uses the live engine's own signature
and window functions and writes only an evaluation record; an integration test checks that its
prediction equals what the engine then does. Overlapping rules that propose the same member-to-anchor
pair count as one link, because that is how the pair is stored. Publishing creates a new immutable
policy version and keeps the current mode and similarity settings.

Automatic grouping is available only through the service certification gate described below.

## Probable cause and runbook recommendations

After a fresh fingerprint, one coalesced `ANALYZE_RESPONSE` item per incident computes three kinds of
finding, written together in one bounded transaction. It is queued only when the effective policy is
not OFF and its `response.enabled` flag is on (default on; older policy versions without the field
read as on). Everything is recommendation only; nothing is executed, muted or paged.

- **Change correlation.** Changes recorded in the six hours before onset, on the same service, on an
  upstream service, or not tied to a service. Score = time proximity (exponential, 60 minute decay)
  × relation weight (same service 1, upstream 0.75^depth, global 0.4) × change kind weight, capped at
  0.9: a change that merely preceded an incident is a lead to verify, not a cause. The card says so.
- **Upstream incidents.** Incidents that opened shortly before on services this one depends on,
  scored the same way.
- **Runbook ranking.** Runbooks bound to the service plus any run against it in the last 180 days,
  ranked by the lower bound of the Wilson interval over succeeded / (succeeded + failed + timed out).
  A runbook that worked once out of once ranks below one that worked 9 of 10. Cancelled and unknown
  runs say nothing about efficacy and are excluded. Only published, non-archived runbooks appear, and
  the card links to the existing runbook page; it never runs one.

**Dependencies.** "Service A depends on service B" edges are managed in Settings → Intelligence →
Services & changes → Dependencies. Only ACTIVE edges influence analysis. An hourly, bounded
queue job consumes new source incidents in 2,000-row cursor pages into service/time buckets.
It resumes incomplete bootstrap work before proposing edges and scores retained metadata rather
than re-reading the raw history each hour. Edges are proposed when incidents on one service repeatedly open within ten minutes after another
(at least five times in 30 days); these are created as SUGGESTED only, are ignored until a person
approves them, and a rejection is permanent. Graph walks are breadth-first with a visited set and a
depth cap of three, so cycles and wide graphs cannot loop or grow without bound.

**Change events.** `POST /api/integrations/changes?integrationId=…` authenticates exactly like the
generic webhook integration and scopes the change to that integration's service (any `serviceId` in
the body is ignored). It never creates an alert or incident and never calls the paging path. Changes
are idempotent per `(source, dedupKey)`, rejected when more than five minutes in the future or older
than 30 days, and kept for the finding retention period.

**Alert quality.** A flag-only leaderboard of services whose incidents mostly resolve within five
minutes or are never acknowledged (at least five incidents in 30 days). It never suppresses anything.

**Visibility.** Findings store numeric and enum evidence only. The viewer's own read rules are applied
to every change (service scope), upstream incident (incident scope) and runbook (runbook scope) at
display time, and anything they cannot read is dropped silently. SHADOW mode records but shows nothing.

### Metric anomaly evidence (optional, lane-only)

Off by default: there are no templates after upgrade and a new one is created disabled. An administrator
(Intelligence manage) attaches a `ServiceMetricTemplate` to a service: a query, an enabled
`ObservabilityConnection` the service's team may use, and bounded tuning (threshold 2 to 50 MAD, 2 to 8
baseline weeks, 15 to 360 minute window, 5 minute to 1 day interval; 10 templates per service, 500 in
total). Code lives in `src/lib/intelligence/metric-anomaly/`; operators read
[the how-to](../v2.2.0/operate/intelligence/metric-anomaly-evidence.md).

- **Scheduling.** Once a minute the lane runs one index-backed probe for enabled templates whose interval
  has elapsed (at most 100 per check, oldest first) and enqueues one coalesced
  `EVALUATE_METRIC_TEMPLATE` work item per template. With no enabled template this is one empty probe.
  Nothing is read or written on the ingestion or paging path; the architecture test forbids the module
  from being imported there.
- **Evaluation.** The handler loads the template under `withDbBudget`, re-checks the connection scope
  (enabled, supports series, allowed for the service's team) and fetches the current window and the same
  window in each baseline week through the connector's guarded fetch, outside any transaction. At most
  two requests per evaluation and two evaluations per process are in flight; the connection's own timeout
  and the lane's abort signal bound each call, and the item's budget is 60 seconds. At most 10 series and
  2,000 points per series are read.
- **Detector.** Pure and deterministic (`detector.ts`). For each sample the baseline is the values at the
  same time of week, plus one step either side, in each baseline week; the score is
  `|value - median| / max(1.4826 x MAD, 1% of |median|)`. A deviation needs two consecutive samples past
  the threshold in the same direction and at least `minDeviation` in absolute terms. A gap ends a run and
  a sample with fewer than three baseline values is not judged.
- **Writing.** One budgeted transaction locks the template row and is fenced on the work generation
  (`lastGeneration`), so an older run never overwrites a newer one. A deviation that overlaps or continues
  one already stored extends it instead of adding a row. The 10 strongest deviations per evaluation are
  kept as `MetricAnomaly` rows (numbers and series labels only; raw series are not stored).
  Incidents the new anomaly may explain are re-signalled for response analysis.
- **Degradation.** A connector error, timeout, missing, disabled or disallowed connection yields no
  evidence: the status is stored on the template (`CONNECTOR_ERROR:TIMEOUT`, `CONNECTION_NOT_ALLOWED`, ...),
  counted in `opsknight_intelligence_metric_evaluations_total{status}`, and the work item completes. Only
  database failures retry.
- **Use.** `ANALYZE_RESPONSE` adds `METRIC_ANOMALY` findings for anomalies on the incident's service or
  an upstream service that began within the cause lookback (six hours) or up to ten minutes after onset.
  Score = time proximity x relation weight x strength (half weight at the threshold, full at twice the
  threshold) x 0.85, capped at 0.9 like every other lead. The incident time axis
  (`timeline/service.ts`) shows them as `METRIC_ANOMALY` rows. Both surfaces filter by the viewer's
  service read scope before reading.
- **Retention.** Anomalies are purged with the finding retention and cascade with their template and
  service.

## Assistant (Squire) and the AI gateway

Everything is configured in Settings → Intelligence → Assistant; there are no environment
variables. Both switches (AI, and showing the assistant) are off by default, and the assistant button is
not even shipped to the browser while it is off.

**Assistant.** A small "Ask <name>" button opens a chat panel. The name is configurable (default
Squire). On an incident page it knows which incident is open. It works with **no AI at all**: a
deterministic router answers "what is on fire", similar incidents, likely causes and runbooks from the
intelligence data. With AI enabled it uses bounded read tools for incidents, timelines, alerts, on-call
people, services, changes, runbooks, postmortems, status pages, outcomes and optional semantic search. Tools run under the asking
user's own permissions through the same visibility rules as the rest of the application, so the model
can never read more than the user can. Write tools only emit typed proposals. A signed, expiring,
actor-bound proposal becomes a change only after confirmation through existing domain commands.
Conversation turns require a provider permitted to receive Personal data, including browser and saved
history. With only Internal providers, Squire explains the restriction and answers in basic mode without
sending the question or history to a model. New gateway resolutions read current persisted provider
policy; concurrent reads may be shared, but policy decisions are never retained in a TTL cache.
Versioned receipts record reserved, running, succeeded, failed or unknown outcomes. Each of the five
current write actions commits its encrypted success result and audit entry in the same transaction as
the native domain mutation. Lifecycle commands also carry stable idempotency keys. Signed preconditions
reject changed lifecycle generations, assignments and relationship decisions rather than overwriting
newer work. Duplicate confirmations return the recorded outcome; uncertain attempts are never resumed
automatically. Owner-only, permission-checked result lookup remains available after proposal expiry for
one day, and cards recover outcomes when reopened. Legacy consumed receipts remain unknown. By default conversations
live in the browser only and audit entries hold metadata (user, provider, model, token counts, prompt id,
version and hash), never prompts or answers.

**Chat client.** `SquireLauncher` reads the newline-delimited event stream and joins text deltas per
animation frame (`delta-batcher.ts`; a short timer when the tab is hidden), so a long answer renders and
re-parses its markdown once per frame rather than once per token; every other event first applies the
queued text, which keeps stream order, and **Stop** keeps the text of the current frame. `SquireMessage` and
its markdown are memoised, so only the answer still streaming is ever re-parsed. The panel is a modal
dialog (`aria-modal`, Tab and Shift+Tab wrap inside it via `focus-trap.ts`) and closing returns focus to
the element focused before it opened, else the launcher. A polite live region announces the current
lookup and completion; during an investigation it names the running step first (`Step 2: … . Checking
recent changes…`). Investigation steps are nested native `<details>` (Enter/Space toggle, visible focus
ring); the trap skips steps inside a folded list, and when the list folds on completion while a step has
focus, focus moves to the list heading. ⌘/Ctrl+J toggles it from any page (key repeat ignored) and is listed in the shared
shortcut registry rendered on `/shortcuts`. Why AI is not answering has four distinct visible states
(`SquireAvailabilityNotice`): **rate limited** (HTTP 429 with an optional Retry-After countdown, or an AI
`Too many requests` reported in the stream) → Retry; **budget** (daily AI budget) → settings link for
people with `INTELLIGENCE_MANAGE`; **disabled** → settings link for the same people; **basic** (AI on but
no permitted provider or a provider failure) → Retry with AI. The stream tells the first two apart with
an additive `limit: 'rate' | 'budget'` on the `meta` and `error` events (`aiLimitFrom` in `contract.ts`);
older clients ignore it and keep showing the shared `quota` availability, and a client meeting an older
server treats `quota` without `limit` as the budget. An AI `meta` event without availability now resets a
stale limit state to ready.

**Basic mode pipeline.** Without a model, a turn runs `planBasicTurn` (`squire/deterministic.ts`):
normalise (contractions, `24h`/`7d` shorthand) → correct spelling against a closed domain vocabulary
(edit distance ≤ 2, first letter fixed, protected ordinary words, names never touched) → classify (the
first-match rules in `intents.ts` decide; when they abstain, weighted keyword features score each
intent and an ambiguous score becomes a two-choice clarification) → extract slots (limit, group-by,
team, person, incident reference, action verb) → resolve names with `pg_trgm` similarity limited to
what the person may read (`basic/entities.ts`, cached 60 s per actor scope) → read (`basic/reads.ts`,
paged, grouped, bounded) → propose → choose answer-aware chips. Dialogue state (pending clarification,
page cursor) is stored on `SquireConversation.state` when history is on and otherwise in memory for ten
minutes per person; it never holds message text. The only writers outside the action executor live in
`intelligence/assistant/` (dialogue state, the suggested-checks library and feedback), kept out of
`squire/` so the architecture test can keep `squire/` read-only and limit `assistant/` to those three
tables. Identical questions are served from a 10-second
per-actor cache with their evidence. A `pageContext` (service, team, schedule, runbook, alert, change) from the
launcher is read under the person's own visibility or ignored. All patterns are bounded literals over a
message capped at 2,000 characters; a unit test times adversarial input. A 300-utterance paraphrase
corpus (`tests/unit/intelligence-squire-nlu.test.ts`) must classify at ≥95% and slots at ≥90%.

**Basic-mode proposals.** An explicit action ("acknowledge this", `/resolve …`, "assign to Alice") on an
incident page becomes a request that `chat.ts` passes to the same `buildProposal` the model's proposal
tools use, so the card is sealed, user-bound and expiring, and execution goes through the existing
confirm route and domain commands. Basic mode never writes; the architecture test's single-writer
invariant still holds.

**Extended actions (opt-in).** `AiSettings.squireExtendedActions` (default off, revision-locked and
audited with the other AI settings) adds nine proposal kinds, declared in
`squire/actions/catalog-extended.ts` and offered as `propose_*` tools only while the switch is on:
`escalate_incident`, `change_urgency`, `snooze_incident` (5 minutes to 24 hours),
`unlink_related_incident`, `add_responder`, `create_jira_issue`, `draft_status_update`,
`publish_status_update` and `run_runbook`. The card text is a fixed server template
(`squire/actions/extended.ts`) with a structured preview (who gets paged, from/to urgency, the Jira project,
the draft text, runbook step and approval counts), a specific confirm label and an impact note for
paging, external systems, public pages and automation. Proposing re-checks the same capability as the
matching UI control and refuses API keys; when the switch is turned off, open cards are refused at
confirmation. Each proposal seals a snapshot of the facts it depends on (escalation step and generation,
urgency, link decision, watcher role, Jira link count, chosen status page, draft revision, runbook binding
revision and version) and the executor re-reads it inside a serializable transaction before acting.

Execution reuses the application's commands: urgency via `applyIncidentUrgencyChange` (extracted from the
incident page action, which now calls it), snooze via the lifecycle engine's `SNOOZE`, unlinking via
`decideRelationship(… 'REVERTED')`, watchers via `setIncidentWatcher`, and runbooks via
`resolveV2RunbookExecution` + `previewRunbookExecution` + `startRunbookExecution` from the sealed binding
on the incident's service (the same resolve, preview and start sequence MCP's `runbook_prepare_execution` /
`runbook_execute_approved` use; the person's confirm stands in for the review, and runbook approval steps
still apply). These commit in the same transaction as the receipt. Escalation (the escalation
service's `requestIncidentEscalation`, keyed by the proposal id so a retry never pages twice), Jira (the
incident page's `createJiraIssueFromIncident`) and status pages (the status page settings route handlers,
called in-process) notify people or call out, so they check the facts first and record the outcome after;
a lost response becomes UNKNOWN and is never repeated. A status update is two proposals: confirming
`draft_status_update` creates an inactive announcement (never shown, no subscriber notification) and
returns a sealed `publish_status_update` follow-up card in the result; that kind is never offered to the
model, so publishing always needs its own confirmation. Basic mode proposes escalate, change urgency and
snooze for an explicit request on an incident page. `create_suppression_rule` and
`create_maintenance_window` are a marked extension point in `catalog-extended.ts`, waiting for their
models.

**Data classes, untrusted data and redaction.** Each tool declares the class of what it returns
(`SQUIRE_TOOL_DATA_CLASS`); the saved turn is classified as the highest of the conversation baseline and
the tools that actually ran. Every tool result reaches the model inside an untrusted-data envelope:
secrets redacted, instruction-shaped text ("ignore previous instructions", role prefixes, fake system
tags) defanged, bounded, and prefixed with a fixed preamble. A proposal made after the turn read tool
data carries `untrustedContext`, and the card asks the person to check that content first.
`redactPersonalData` removes emails, phone numbers and IP addresses where a lower class is required.

**Shared breaker state.** Provider breakers stay in-process, but read a shared row
(`AiProviderBreaker`) at most every five seconds per provider and publish each outcome best-effort, so
one replica's discovery that a provider is down reaches the others. A failing table leaves each replica
on its own judgement.

**Evaluation and feedback.** Squire is evaluated in three tiers that share nine categories (RCA quality,
tool choice, wanted and unwanted proposals, multi-turn, prompt injection, permission scope, data-class
handling, cost ceiling; `tests/evals/squire/categories.ts`).

- _Basic mode_ (`basic-cases.ts`, 48 cases, some with follow-ups) runs against a seeded database with no
  model on every pull request (`squire-evals-contract.test.ts`).
- _AI mode against a scripted model_ (`model-cases.ts`, 100 cases) also runs on every pull request
  (`squire-evals-model.test.ts`). A local OpenAI-compatible fake returns the replies each case fixes, so
  what is measured is everything around the model: which tools are offered under which data class, what a
  tool returns under the asker's permissions, what reaches the provider after redaction and instruction
  defanging (alerts, notes, change summaries, postmortems, pasted secrets, and connector logs, traces,
  error events and code diffs), which proposals become cards (at most two, flagged after third-party text),
  what may be cited (only sources read in the turn), and where the step, output, reservation, daily and
  per-person ceilings stop a turn. The runner turns on the opt-in switches (extended actions, the knowledge
  index) and seeds one observability connection per capability (Loki, Prometheus, Tempo, Sentry, GitHub)
  against a local stand-in whose payloads carry injected instructions, credentials and an email address.
  No case is ever skipped: the runner reads what the assistant really offers from a probe turn per asker and
  fails when an offered tool or proposal has no case, and a unit test requires a scripted proposal for every
  action in the catalogue, so a new tool or action cannot land unevaluated.
- _Live model_ (`cases.ts`, 22 cases) runs nightly in `squire-evals.yml` when `SQUIRE_EVAL_API_KEY` is set.
  Structural checks (tool used, incident cited, nothing hidden leaked, proposal made or not, follow-up
  answered) decide pass or fail; an LLM judge (`judge.ts`) then grades each answer 1–5 against its
  category's rubric, with the answer fenced as data. `scripts/check-squire-eval-baseline.cjs` fails the run
  below the stored pass rate, when a must-pass case failed or did not run, when a case used more than
  `maxTokensPerCase`, when the judge's mean or pass rate drops below baseline (or too few answers could be
  graded), or when a keyed run recorded nothing. Without a key the suite is skipped and nothing is compared.
  `baseline.json` is raised by committing a reviewed value; `--record-catalogue` refreshes only
  `minimumCases`, which a unit test enforces so the set cannot quietly shrink.
- _Token guard (K9)._ Every live case records its tokens, and the gate fails when the median per case is
  more than `maxMedianTokenRise` (15%) above the committed `medianTokensPerCase`; `--record-tokens
<report>` writes a reviewed run's median, never a passing run on its own. The scripted tier estimates the
  prompt tokens of every request a case sends (`estimateTokens` over the request body) and fails the same way
  against `modelMedianPromptTokens`, so a prompt or tool-schema growth is caught on every PR without a key.

Labelled engine fixtures sit beside them: `tests/fixtures/intelligence/storm-fixture.ts` (35 incidents,
three real problems, one-offs and decoys) must reach a compression ratio of at least 2.9 with no group
mixing two problems, and `rca-fixture.ts` (eight scenarios) must rank each expected top cause first
(`engine-fixtures.test.ts`). Thumbs up/down with a reason are stored in `SquireFeedback` (mode, intent,
reason and a question digest only) and summarised on the Quality page.

**Incident-response tools.** `squire/tools-incident.ts` adds five read tools, registered from
`tools.ts`: `get_alert_payload` (one alert of a readable incident; the payload is pruned to bounded depth,
width, array length and string length, credential-named keys lose their values and every string is
secret-redacted and instruction-neutralised; Personal), `get_runbook_steps` (the published steps of a
readable runbook: name, type, risk class, approval flag and description, never step configuration;
Internal), `get_slo_status` (active objectives of a readable service with attainment from
`evaluateServiceObjective`, so it is computed under the reader; Internal), `incident_analytics` (counts by
status and urgency, mean time to acknowledge and resolve from the SLA elapsed columns, and the five
noisiest services, all as database aggregates over `incidentReadWhere`, bounded to 720 hours; Internal) and
`get_escalation_policy` (steps of a readable service's policy; schedules the reader cannot open stay
anonymous; Personal). Each declares its class in `INCIDENT_TOOL_DATA_CLASS`, merged into
`SQUIRE_TOOL_DATA_CLASS`, and the evidence registry maps each result to alert, incident, runbook, service
or schedule sources so citations work.

**Model routing.** `AiSettings.capabilityRouting` (nullable JSON, validated on save and on every read by
`ai/routing.ts`) may name a preferred provider, and optionally a model on it, per capability
(`SQUIRE_CHAT`, `SUMMARIZE`, `DIAGNOSE`, `POSTMORTEM`, `CLASSIFY`; embeddings are pinned separately). The
language-model resolver now honours the capability: it first selects the chain the data policy allows
(data class, region, external fallback) and only then moves the routed provider to the front, so a route
can never send data to a provider that would not otherwise receive it. The rest of the chain stays as
fallback, and an unset route means the priority chain unchanged. `updateAiRouting`
(`ai/routing-settings.ts`) shares the settings revision lock and compare-and-set, checks that every routed
provider exists and audits `intelligence.ai.routing.updated`; the general settings form leaves both
columns untouched.

**Investigation mode (off by default).** With `squireInvestigationEnabled`, a diagnostic question
("why…", "what caused…", "investigate…", "root cause"; an ambiguous symptom question on an incident is
classified by the `CLASSIFY` route) runs `squire/investigation/engine.ts` instead of the single streamed
answer: a planner on the `CLASSIFY` route picks up to four read tools per step (deduplicated, unknown
tools and malformed input dropped), they run in parallel under the person's permissions, and after at most
12 steps a diagnosis on the `DIAGNOSE` route returns ranked hypotheses with a confidence and the evidence
handles that support them, plus next checks. A per-question token ceiling (60,000 or a tenth of the daily
budget, whichever is smaller, with a reserve for the conclusion) stops planning early. On the step limit,
the ceiling, cancellation or a failed diagnosis the answer is a partial one listing what was checked and
the evidence read; only when planning fails before any read does the turn fall back to basic mode.
Citations come only from evidence read in the turn: cited handles that were not read are removed and a
hypothesis left with none is not shown. Each step is streamed as an `investigation` NDJSON event (sent
when the step starts and again when it finishes, with the same index) and rendered as collapsible steps
above the answer. The engine has no data access of its own and never proposes writes; the architecture
test checks both. Each planning call is a separate gateway request, so per-minute request limits and the
daily budget apply to it.

**Earlier turns.** Saved conversations replay the last ten turns verbatim, as before. Turns before that
window (user questions and verified, completed answers only) are summarised into one system message placed
straight after the system prompt, so the incident briefing stays pinned first: with AI on, by the
`SUMMARIZE` route (bounded input and output, classified at the highest class of the turns); otherwise, or
when that call fails, by a deterministic digest of the questions and answer leads. Browser-held history is
unchanged (the request schema still keeps the latest ten turns).

**Squire outside the web app (opt-in).** Three switches in the AI settings, all off by default and each
also requiring the assistant itself to be on: `squireChatOpsEnabled` (Slack and Microsoft Teams),
`squireMcpEnabled` (the `ask_squire` MCP tool) and `squireMobileEnabled` (mobile incident pages). Every
surface runs exactly the web turn (`collectSquireTurn` in `squire/surfaces.ts` wraps `streamSquire`):
basic or AI, the person's own permissions, the same tools, citations and sealed proposals.

- _Slack._ `@squire <question>` (an `app_mention` event) in an incident channel is verified, queued
  through the durable ChatOps intent pipeline (de-duplicated by Slack's `event_id`, nothing queued while
  the switch is off) and answered by the worker in the thread with `chat.postMessage`. The stored response
  is encrypted, like the request payload. `/incident ask <question>` answers privately to the asker. The
  Slack account resolves to an OpsKnight user through the existing verified-email mapping; an unlinked
  account gets no answer. Only incident channels (bound to the signed workspace exactly as `/incident`
  binds them) are answered, with the channel's incident as context.
- _Teams._ An @mention of the bot in an incident war room (the bot must be the mentioned entity, so
  channel-message permissions never make it answer everything) is queued the same way and answered in
  the thread through the Bot Connector, with the JWT-verified, trusted-host service URL. The person
  resolves through the existing Teams identity links (`ChatIdentityLink`).
- _Confirm buttons._ A write proposal becomes Confirm/Dismiss buttons (Slack) or an `Action.Execute`
  (Teams) carrying the sealed token and the asker's user id. The click resolves the clicking account,
  refuses anyone but the asker, rate-limits (20 per minute per person; questions: 6 per minute), and
  calls `executeSquireAction(actor, token, channel)`. With a chat channel the executor authorizes the
  user inside the same serializable transaction as the domain command (the ChatOps incident
  authorization, plus the responder floor for resolve and reassign), re-checks the signed preconditions
  and writes the receipt and an audit entry with `source: INTEGRATION`. A result is posted to the channel
  only from the executor's own outcome. A sealed token too large for a Slack button (a long resolution
  note) is offered as an OpsKnight link instead.
- _MCP._ `ask_squire` is listed only while the switch is on and only for connections granted every read
  scope Squire's tools use (`incidents`, `services`, `schedules`, `teams`, `runbooks`, `postmortems`),
  so asking cannot read more than the connection could. It is read-only: proposals come back as
  descriptions with a link and never with their token; the architecture test keeps the executor out of
  the MCP module. Answer text is projected like other MCP business text. 10 questions per minute per
  person.
- _Mobile and page context._ `/m/incidents/[id]` mounts the same lazy launcher full screen
  (`MobileSquireMount`). The launcher derives page context from desktop and mobile paths
  (`components/squire/page-context.ts`): incidents, services, teams, schedules, runbooks, alerts and
  changes. A change page resolves through `readChangeReference` (its service's visibility) and makes
  "this service" mean the change's service; runbook pages resolve under `runbookReadWhere`.

**Panel surfaces (web).** Entry points, display and deep links live beside the launcher in small modules
so `SquireLauncher.tsx` only wires them in (`use-squire-surfaces.ts`):

- _Bus contract_ (`components/squire/squire-bus.ts`). `openSquire()` takes a string (asked at once, the
  original form) or `{ message?, question?, evidence?, incidentId? }`. `message` is sent; `question` is
  only placed in the composer; `evidence` is a handle `{ kind, id, label? }` naming the item the question
  is about and is shown as an "About" chip; `incidentId` is the incident the caller is showing.
  `parseSquireOpenDetail` treats the event detail as untrusted: wrong types, over-long text and ids that
  are not plain identifiers are dropped. The handle is client-side context only; it is not sent to the
  chat route, whose request contract is unchanged.
- _Finding anchors._ `findingAnchor(id)` is `finding-<findingId>` and `findingHref(incidentId, { kind, id })`
  is `/incidents/<id>?insights=<section>#finding-<findingId>` (`/m/...` on mobile). The section comes from
  the evidence kind (`similar`, `related`/`group` → `related`, `cause`/`change`/`upstream` → `why`,
  `runbook` → `runbooks`, `triage`, `impact`, `summary`, `briefing`). The insights inspector renders the
  matching element ids; Squire's pinned briefing, the "About" chip and the finding link beside a cited
  source all build links through these two functions.
- _Docked display_ (`components/squire/dock.ts`). A third display next to floating and expanded, for
  viewports at Tailwind `lg` and wider and never for the full-screen mobile presentation. While docked
  and open the launcher sets `--squire-dock-width` (`clamp(20rem, 26vw, 28rem)`) and the `squire-docked`
  class on `<html>`; the app shell's content row (`src/app/(app)/layout.tsx`) has
  `lg:pr-[var(--squire-dock-width,0px)]`, so the page reflows and falls back to no padding whenever the
  variable is absent. The panel is fixed below the app header on the right. The explicit choice is stored
  in `localStorage` `opsknight.squire.display` (next to `opsknight.squire.side`). Without a stored choice
  the panel floats, except that a bus request whose `incidentId` equals the page's incident docks it until
  the person leaves that incident. Esc, focus return and the `⌘J` shortcut are unchanged.
- _Pinned briefing._ `GET /api/intelligence/squire/briefing?incidentId=` (session only, same-origin, 60
  per minute per person, `no-store`) returns `getPinnedBriefingForActor` (`squire/briefing-view.ts`): the
  top three similar incidents, likely changes and runbooks with their finding ids, composed from
  `getSimilarIncidentsForActor` and `getResponseIntelligenceForActor`, the same reads and cut as the chat
  briefing (`brief` in `chat.ts`). Those views apply `incidentReadWhere`, `serviceReadWhere`,
  `runbookReadWhere` and the service's effective mode (only SUGGEST and AUTO show anything), so OFF and
  SHADOW yield `briefing: null`, as do an unreadable incident, the assistant being off and "no findings";
  the response does not tell these apart. `SquirePinnedBriefing` renders nothing for null. The mounts pass
  `pinBriefing`; the launcher requests the briefing only on an incident page while the panel is open.
- _Deep link_ (`components/squire/deep-link.ts`). `?squire=open&q=<question>` opens the panel with the
  question in the composer and then removes both parameters with `history.replaceState`. It never sends:
  a link must not be able to start a turn or spend budget.
- _Command palette._ `SidebarSearch` offers "Ask <name>" when the query names the assistant, uses a
  trigger word or reads as a question, and calls `openSquire(question)` with the addressing words removed
  (`components/squire/palette-question.ts`).

**Saved conversations (opt-in).** An administrator can let people save conversations. The chat route then
stores each completed answer (never a failed or cancelled one) in `SquireConversation`/`SquireMessage`,
encrypted at rest and registered in the encryption registry. Every read and write is keyed by the owner,
so someone else's conversation is indistinguishable from one that does not exist; the endpoints accept
signed-in, same-origin browsers only, never API keys. Storage is bounded (50 conversations per person,
100 messages each), idle conversations are deleted after the configured retention (1–365 days), turning
the dedicated history setting off deletes saved conversations in bounded batches, and deleting a person
deletes theirs. Pausing AI or hiding the assistant preserves unexpired conversations; normal retention
continues while access is unavailable. The storage code
rejects continuation in a different incident/global context and
lives outside the assistant module, and an architecture test limits it to those two tables.

**Incident summaries and postmortem drafts.** On an incident, "Summarise" produces a short structured
summary; in the postmortem editor, "Draft with AI" fills only fields that are still empty and adds
de-duplicated action items. Both read the incident through the requester's own visibility, run only on
providers whose ceiling is Personal (timelines include responder names), and validate the model's output
against a bounded schema before anything is shown. Nothing is saved until the person saves the form.

**Prompt registry and guidance.** Every prompt is a versioned entry in a registry; its id, version and
content hash are written to the audit entry of every call. Administrators can add short guidance per
prompt (for example house style). Guidance is sanitised, revision-locked and audited, and is appended
after the fixed rules with an explicit statement that it cannot override them.

**Structured output.** Calls that need data rather than prose ask the provider for JSON matching a schema,
then re-validate it locally. Invalid output is never returned: the next eligible provider is tried, and if
none produces valid output the call fails with a clear error.

**Prompt-injection posture.** The browser can send only user and assistant turns (never a system turn),
bounded in number and size. The system prompt tells the model that tool output and incident text are
data, never instructions. That prompt is defence in depth only: authority never rests on it, because
read tools are permission-checked and proposed writes require explicit confirmation. Model output is
rendered as plain text. Citation chips for incidents, runbooks, changes and alerts are re-authorized
against their source before rendering links; guessed or inaccessible ids are dropped.

**Gateway.** Providers are added in the UI: OpenAI, Anthropic, Google Gemini, Azure OpenAI, Amazon
Bedrock, Google Vertex AI, Mistral, Groq, and any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM,
OmniRoute). Credentials (an API key, an AWS access-key pair, or a Google service-account key) are encrypted
at rest, registered in the encryption registry, and never returned to the browser; changing a provider's
kind requires entering a new credential. Vertex AI obtains short-lived OAuth tokens from Google's fixed
token endpoint; every model request still goes through the guarded fetch. The runtime is the AI SDK 6 line (the product
is pinned to Node 20, which AI SDK 7 does not support); everything depends on a small provider-neutral
port, so moving to a newer SDK later is a one-adapter change.

- **Egress is guarded.** Public endpoints must be HTTPS and resolve to public addresses, validated at
  save time and again at every request, with redirects disabled. A private-network endpoint (for
  example Ollama) needs explicit administrator consent, and only that exact origin is ever contacted.
  An architecture test requires every provider constructor to use the guarded fetch.
- **Data ceilings and fallback.** Each provider declares the most sensitive data class it may receive.
  Fallback is ordered by priority but can never widen where data goes: a self-hosted primary does not
  fall back to an external provider unless an administrator allows it, and a provider whose ceiling is
  below the request's data class is never used. There are no hedged or parallel requests.
- **Data residency.** A provider can carry a region tag (for example `eu`). When an allowed-regions list
  is set, only providers tagged with one of those regions are ever used, for chat and embeddings alike.
- **Test connection.** Each saved provider has a button that sends one fixed tiny prompt through the same
  guarded fetch and reports only a fixed category (connected, unreachable, rejected, timeout), never
  provider error text.
- **Resilience.** Per-provider circuit breakers (open after three consecutive failures, one probe after
  30 seconds), bounded timeouts, and fallback only before the first token of a streamed answer so two
  answers are never spliced. When AI is unavailable, over budget or rate limited, the assistant answers
  in basic mode instead of failing.
- **Cost controls.** Per-user requests per minute, global and personal daily token budgets (UTC day), a cap on
  answer length and on model/tool round trips. Credential-shaped text is redacted from everything sent
  to a model, including tool results. Admission atomically reserves estimates across concurrent requests
  and settles once per attempt, including estimated usage on cancellation/failure and provider tests.
- **Cost governance** (`ai/pricing.ts`, `ai/cost.ts`, `ai/scoped-budget.ts`). A pure price table (USD per
  million input/output tokens; built-in list prices for the hosted provider kinds, longest family-prefix match
  after stripping host decorations such as Bedrock region/vendor prefixes, plus administrator overrides per
  provider kind and exact model in `AiModelPrice`, cached 30 s) turns usage into integer micro-dollars.
  Settlement adds the cost to `AiUsageDay.costMicros` and `AiUsageUserDay.costMicros` (nullable; older rows
  stay null) and to `AiUsageBreakdownDay` (day × attributed team × capability × provider kind × model, with an
  unpriced-request count). Each call is attributed to one team (the incident's team, else the person's earliest
  membership, else none) once per request and the attribution is stored on the reservation, so settlement and
  enforcement agree. Optional `AiBudget` rows (key `team:<id>` or `capability:<CAP>`, daily token and/or
  dollar limit, revision compare-and-set, audited) are checked inside the same day-advisory-locked
  reservation transaction as the global, background and personal budgets, counting settled breakdown rows
  plus live holds (`AiTokenReservation.teamId/capability/costMicros`); a read failure throws, so admission
  fails closed. Unpriced calls count toward token limits only. Refusals increment
  `opsknight_intelligence_ai_budget_rejections_total{scope}`; the scrape exports per-scope maximum
  utilisation and counts of budgets at 80% and 100% (no identifiers), alerted by `OpsKnightAiBudgetNearLimit`
  and `OpsKnightAiBudgetExhausted`. Only `scoped-budget.ts` writes the breakdown and only `cost.ts` writes
  prices and budgets (architecture test). The settings page shows 7/30-day spend by team, capability and model
  with dependency-free bars backed by tables. Operator guide: `docs/v2.2.0/operate/intelligence/ai-cost.md`.
- **Token efficiency** (`ai/result-cache.ts`, `ai/call-site.ts`, `ai/brief.ts`, `ai/output-limits.ts`).
  - _Result cache (opt-in, `AiSettings.resultCacheEnabled`)._ `cachedGenerate` and `cachedGenerateStructured`
    wrap a resolved port. An entry in `AiResultCache` is keyed by capability, prompt id and
    version, the routed model (`LanguageModelPort.model`), a scope key (`<data class>|team:<attributed
team>|<caller scope>`) and a SHA-256 of the exact messages, answer-length cap and schema name. The answer
    is encrypted with `encrypt()`, expires after 24 hours and is purged in batches by the retention job
    (`aiResults`). Only a complete answer is stored: an error, a finish reason other than `stop` (refusal,
    content filter, cut-off), empty text, a tool conversation or schema-invalid output never is, and a stored
    object is validated again on read. A hit returns zero usage and `cached: true`, takes no rate-limit slot or
    reservation, and adds only `resultCacheHits`, `savedTokens` and `savedCostMicros` to the day's breakdown
    row. Any cache failure falls back to the live call. Callers: `summarizeIncident`, `draftPostmortem`,
    proactive notes, the handoff narrative (scope `user:<recipient>`), and the conversation summariser (scope
    `user:<actor>`; Squire chat itself uses the deterministic digest and makes no summariser call). Only `result-cache.ts` writes the table (architecture test).
  - _Deterministic-first gate._ `AiRequestContext.callSite` (`interactive | proactive | background`) is
    required; the gateway checks it before admission and refuses an untagged call with `CALL_SITE_REFUSED`.
    List and badge loaders (`getIncidentListBadges`, `getWallboardNoiseTile`, overview `loadSection`) run inside
    `deterministicOnly()`, an `AsyncLocalStorage` zone in which every model call is refused whatever its tag,
    cached or not. `tests/architecture/ai-call-site-contract.test.ts` fails on an untagged call site, a literal
    `maxOutputTokens` outside `ai/`, or a component or list loader importing the gateway.
  - _Compact inputs._ `incidentBrief()` builds the one incident brief used by the summary, the postmortem
    draft and the proactive notes, with a hard character budget per section (`BRIEF_BUDGETS`); a section keeps
    whole lines and states how many it left out, and timelines and notes keep the most recent lines. The
    handoff narrative uses the same `renderBrief()` and shows incident ages as coarse bands so an unchanged shift hashes
    the same. `AI_OUTPUT_TOKENS` is the single per-feature answer-length table.
  - _Honest accounting._ The gateway reads `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` from the
    AI SDK (Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`, Bedrock
    `cacheReadInputTokens` / `cacheWriteInputTokens`, OpenAI-style `prompt_tokens_details.cached_tokens`);
    `inputTokens` is the total and already includes them. `costMicrosFor` prices uncached, cache-read and
    cache-write tokens separately: Claude families on Anthropic, Bedrock and Vertex use 0.1x input for reads
    and 1.25x for the 5-minute writes the gateway requests; every other family is charged the full input rate
    (never an invented discount). `AiUsageBreakdownDay.cacheReadTokens/cacheWriteTokens/resultCacheHits/
savedTokens/savedCostMicros` are nullable and additive; the spend page shows **Saved by cache** (result
    cache plus net provider-cache saving, floored at zero) and the saving per capability.
  - _Spend controls_ (`AiSettings.spendControlsEnabled`, off by default). Routing defaults: `CAPABILITY_TIERS`
    in `ai/routing.ts` maps CLASSIFY and SUMMARIZE (tool hops, phrasing, conversation summaries) to `small` and
    DIAGNOSE, POSTMORTEM and SQUIRE_CHAT (synthesis) to `strong`; `PROVIDER_MODEL_TIERS` names each provider
    kind's two models from the price table (deployment-named hosts have none and keep their model).
    `resolveGatewayPort` applies `applyDefaultTiers` first and the administrator's `capabilityRouting` on top,
    so a custom route always wins; the routing form shows "Default" or "Custom route" per capability.
    Background allowance: every reservation stores its `callSite`; `proactive` and `background` holds and
    settled tokens (`AiUsageDay.backgroundAiTokens`) count against `backgroundAiTokenBudget()` (default 30%,
    at most 80% of the daily budget), checked in the same serialisable reservation transaction as the global,
    personal, team and capability budgets, so concurrent background calls cannot overshoot (the spend-controls
    integration test races concurrent background, personal and mixed holds). Proactive notes are also capped per service per UTC day with the shared
    fixed-window rate limiter (`ai:proactive-notes:<serviceId>`). Degradation: `admitAiRequest` marks a
    request `degraded` from `AI_DEGRADE_AT` (80%) of the global or personal budget; the gateway then forces
    the `small` tier for every provider in the chain, halves the answer-length cap, sets `degraded: true` on
    the result (never stored by the result cache), and background calls are refused from that point and may
    never reserve past it. At 100% every call is refused with `BUDGET_EXHAUSTED` as before; Squire shows its
    basic-mode notice and drafts show `DRAFT_FAILURE_MESSAGES.BUDGET_EXHAUSTED`. Degraded answers show
    `AI_LEAN_NOTICE` in Squire (a `notice` event), the incident summary and the postmortem editor.
  - _Batched insight phrasing._ `phraseInsights(actor, scope, insights)` in `ops-insights/phrasing.ts`
    phrases all of one scope's insights (at most 12) in one `cachedGenerateStructured` call (SUMMARIZE,
    `interactive`, prompt `insights.phrasing` v1, `AI_OUTPUT_TOKENS['insights.phrasing']`), keyed by insight
    id; ids it was not sent are dropped. The brief carries ids, severity, title, summary and evidence facts
    only. `phraseInsightsForScope` reads the insights again with `listInsightsForScope` under the viewer, so
    a scope the viewer cannot read sends nothing; USER-scope insights use the PERSONAL data class and a
    `user:<viewer>` cache scope. `InsightsPanel` takes an optional `phraseScope` and renders the
    `InsightPhrasing` disclosure, which calls `phraseInsightsAction` on the first expand only.

**Observability connectors (opt-in).** Settings → Intelligence → Assistant → Connections stores read-only
`ObservabilityConnection` rows: Prometheus, Loki, Tempo, Grafana (through its data-source proxy),
Datadog, Elasticsearch, CloudWatch, Sentry, GitHub and GitLab. Each has a base URL validated exactly like
an AI provider's (HTTPS and public addresses unless the administrator gives private-network consent;
metadata and link-local addresses never), a credential encrypted with the application key (never logged,
returned or audited; only "replaced"), optional region/org/project scoping, a team allow-list (empty means
every team; global service readers can use every enabled connection), a 1–30 s timeout, and `enabled`
false by default. Every change is audited in the same transaction. A stored credential cannot be
re-pointed to another origin or kind without being entered again.

`src/lib/intelligence/connectors/` holds one small adapter per kind (`adapters/*.ts`) that turns a typed
query into a GET (or a read-only search POST; CloudWatch's JSON protocol is POST and is SigV4-signed)
through `connectors/http.ts`. That module is the only network path: it wraps the gateway's
`guardedFetchFor` (SSRF-safe public fetch, or the consented origin pinned exactly), adds the
connection's timeout, disables redirects, refuses bodies over 2 MB (declared or streamed) and maps
failures to fixed codes without vendor text. Adapters take an injected fetch, so every kind is unit-tested
with a fake (success, timeout, oversized, non-2xx) and with the real guarded fetch (metadata and private
targets refused). `normalize.ts` reduces results to compact summaries sized to fit the tool-output cap:
per-series min/max/mean/last, the biggest jump and five samples (at most 8 series); the newest 15 log
lines; up to 3 span trees of 20 spans with errors marked; 10 error issues; and for diffs the files,
additions/deletions and a 3,000-character patch.

Squire's tools for them live in `squire/tools-observability.ts`: `query_metrics`, `search_logs`,
`get_traces`, `get_error_events` and `get_change_diff` (which resolves a `ChangeEvent.url` for a GitHub or
GitLab commit, pull/merge request or compare view to a connection whose web host matches). The chat route
lists the person's eligible connections once per AI turn, and a tool is offered only if at least one
enabled connection of a capable kind is allowed for them; the connection is checked again when the tool
runs. Windows default to one hour around the incident's start (or the last hour) and never exceed 24
hours or the present. Results have secrets redacted; Internal-class results also lose emails and phone
numbers. `search_logs` is Personal (log lines can carry customer data) and is not offered when the turn
is not cleared for Personal data; the others are Internal. Each result is recorded as an `observability`
evidence source (and the change, for diffs), which replay re-authorizes against the connection's current
enabled state and team list. An architecture test pins the connectors to the guarded fetch and to writing
only their own table.

### Knowledge memory and proactive Squire (opt-in)

Everything below is off by default and lives in `src/lib/intelligence/memory/`. Operator guide:
`docs/v2.2.0/operate/intelligence/squire-memory.md`.

**Knowledge index.** `KnowledgeChunk` holds bounded (800 characters, at most 6 per source), secret-redacted
passages from postmortems (narrative plus, after it, a timeline summary of at most 12 entries, up to 5
five-whys and up to 10 action items, each line cut at 160 characters: `POSTMORTEM_KNOWLEDGE_LIMITS`), resolution notes (the resolve message), incident notes (20+ characters), the
step names and descriptions of published runbook versions (never step configuration), and person-confirmed
service facts. `searchVector` is a database-generated `tsvector` (like `IncidentFingerprint.searchVector`);
a trigram index is added when `pg_trgm` is installed; `embedding` is optional. `contentHash` (sha256 of title
and text) makes the sync idempotent: unchanged sources are never rewritten or re-embedded.

- **Sync.** A global switch (`SquireMemorySettings.knowledgeEnabled`, revision compare-and-set, audited)
  lets the lane schedule one coalesced `SYNC_KNOWLEDGE` work item every 5 minutes. Each pass walks each
  source kind on its own keyset cursor (`IntelligenceCursor` rows `squire-knowledge:<kind>`, over
  `(updatedAt|createdAt|resolvedAt, id)`, settled 30 s behind `now()`), 100 sources per kind per pass, each
  kind in its own `withDbBudget` transaction so one slow kind never blocks the others. Sources on services
  whose intelligence policy is OFF are not kept, and a rolling prune removes what was indexed before a
  policy changed. When a pass is full it re-enqueues itself. Optional vectors use the background embedding
  identity and budget share (Personal data ceiling), and only when an embedding provider is configured.
- **Retention.** The intelligence retention sweep removes incident-linked chunks older than the fingerprint
  retention, and every derived chunk while the switch is off (bounded batches). Chunks cascade with their
  incident, note, postmortem, runbook or service. Confirmed facts stay until a person removes them.
- **Search.** `searchKnowledgeForActor` pre-filters by the reader's teams (index-backed), ranks by
  `ts_rank` with an OR query of distinct words, falls back to trigram similarity for typos, and re-ranks
  semantically only when chunks carry vectors of the configured model. Visibility is never decided by the
  index: each candidate is re-checked against its source through `incidentReadWhere`, `runbookReadWhere`
  or `serviceReadWhere` before it is returned.
- **`search_knowledge` tool** (`squire/tools-knowledge.ts`, registered from `tools.ts` only while the
  switch is on): at most 8 passages, each with a citable source (incident, postmortem, runbook or service)
  that the evidence registry records; INTERNAL data class, PERSONAL when personal tools are on; output is
  capped by the gateway's `capOutput` and wrapped in the untrusted-data envelope like every tool result.

**Learned service facts.** In AI mode Squire may call the `learn_service_fact` proposal (only offered while
the index is on). It is a normal sealed, user-bound proposal; the card is shown only to people who may
curate the service's knowledge (intelligence managers, people who may update the service, or members of
the owning team with intelligence feedback rights; never API keys), and facts that look like credentials are refused rather than stored redacted.
Confirmation runs in `squire/actions/execute.ts`, which calls `recordServiceFactCommand` in a serializable
transaction; it re-checks the switch, incident access, curation rights, the fact and the per-service cap
(50), and uses the proposal id as the fact's identity so a replay never stores it twice. Facts are listed
and removable (audited) on `/settings/intelligence/services/<id>/squire`. An architecture test pins
`recordServiceFactCommand` callers to the executor.

**Proactive Squire.** `SquireServicePolicy` (per service, every switch off by default, revision
compare-and-set, audited) opts a service into three lane jobs. A `SQUIRE_PROACTIVE_SCAN` item runs every
minute only while some service opted in; it enqueues one `SQUIRE_PROACTIVE` item per `(kind, incident)`
(subject `KIND:incidentId`), and each item is generation-fenced on the stored note. Nothing runs on the
paging path.

- **Briefing** for incidents opened in the last 6 hours, after the first analysis snapshot (or after a
  5-minute grace without it, flagged as such): summary facts, similar incidents (same service, public
  visibility only, since the job has no person's permissions), a likely change (correlation, labelled
  unconfirmed) and a suggested runbook.
- **Stakeholder-update nudge** when an open incident had no note or status-page update for N minutes
  (5 to 1440); one nudge per silence, hidden as soon as someone posts an update. Carries a draft update.
- **Postmortem draft** on resolve, only when no postmortem exists. Draft only: it is shown on the incident
  page and never creates, saves or publishes a postmortem.

Content is deterministic with AI off. With AI on, the job asks the gateway under a background identity
(`squire:proactive`) through the `incident.summary` (SUMMARIZE) or `postmortem.draft` (POSTMORTEM) prompts,
with a redacted brief marked as data; any AI failure keeps the deterministic note.

_Why not a timeline note._ Intelligence code may not write incident tables, and Squire writes only through
`execute.ts` on behalf of the person who confirmed; there is no system-actor note command. Proactive output
is therefore stored as an intelligence finding (`SquireProactiveNote`, one per incident and kind, follows
finding retention) and rendered in the Briefing section of the incident's insights inspector (`ProactiveNotes`). Rendering re-checks
every reference through the viewer's rules and shows AI text only when the viewer may read every record
the model saw; otherwise the deterministic version is shown.

## Semantic search (optional)

Background incident embedding additionally reserves against a configurable sub-limit (default 20%,
maximum 80% of the same global daily budget). Interactive query embeddings use the signed-in person's
allowance. The UTC-day advisory lock serializes global, personal and background admission with
settlement; live holds count toward all applicable limits. Actual usage is charged once using the
reservation's stored identity and day. Expected budget/rate pauses complete the background pass and
leave it for periodic discovery, rather than spending retry attempts. Existing vectors and embedding
space identity are unaffected by budget changes. Reservations use estimates, so actual provider
charges can exceed an estimate and block subsequent calls. Upgrade-day unclassified usage is
conservatively charged against the background allocation; global and personal totals are unchanged.

With AI on, an administrator can turn on semantic search and give a provider an embedding model. Masked
incident titles can still contain names or other personal text after numbers and identifiers are removed. They are classified as Personal and are then
embedded, and similar-incident search also matches by meaning, not just wording.

Background embedding checks the current service policy before reading title text. OFF services are excluded before the candidate batch limit. Changed source text is queued for the native indexer instead of being sent from an old fingerprint; policy, source ownership and provider eligibility are rechecked before responses are stored.

- **No extension.** Vectors are unit-normalised `REAL[]` rows in `IncidentEmbedding`; similarity is a dot
  product computed in the database over a bounded number of the most recent vectors of the same model.
  Vectors from different models are never compared. The gateway uses a versioned opaque compatibility
  key over provider ID, endpoint, model alias and the cloud deployment selectors it actually uses.
  Credentials, display name and priority are excluded. The provider request still uses the actual model
  alias. Legacy model-only keys are not considered compatible: recent vectors rebuild through the
  existing opt-in, budgeted embedding lane, while older rows age out normally. Pin model revisions;
  changes behind an unchanged upstream alias cannot be inferred. Embedding selection stays on the first
  policy-eligible deployment during a circuit-breaker outage. New embedding calls wait for its recovery;
  existing compatible vectors remain usable. Chat fallback is unchanged. Administrative provider,
  priority, clearance or residency changes can still select another eligible deployment.
- **Never in the paging path or in front of analysis.** Incidents are analysed lexically as soon as they
  are indexed. A single coalesced `EMBED_PENDING` work item then embeds up to 32 pending incidents per
  provider call and re-queues their analysis, so a storm costs one call per batch, and a slow or failing
  provider only delays the semantic signal. Unchanged titles are never re-embedded.
- **Conservative scoring.** Cosine below 0.7 counts as no signal; above it the value is rescaled and can
  raise content similarity but never lower it. The match is explained as "Similar meaning", and the raw
  cosine is stored with the other numeric evidence. A failed semantic query falls back to lexical results.
- **Lifecycle.** Vectors cascade with their incident and follow fingerprint retention. The AI settings
  page shows the model in use, how many incidents are indexed, and how many are waiting.

## Per-service policies

Settings → Intelligence → Services & changes → Per-service policies shows, for each service, the mode that applies and
whether it comes from the service's own policy or the global one. An administrator can create an override
(it starts from what currently applies), publish new versions of it, or return the service to the global
policy. Turning an override off sets `IntelligencePolicy.overrideActive = false`; it never deletes history,
and publishing or rolling back re-activates it. The list is built in a fixed number of queries for a
bounded page of services, filtered by the viewer's own service visibility.

## Insights and adaptive suggestions

Settings → Intelligence → Evaluation & spend → Insights is computed on demand from bounded queries, so there is no background
job to fall behind. Everything is flag-only and a person decides what to do.

- **Recurring problems.** The same masked incident title at least three times on at least two days in
  30 days, per service, with a flag when the service has no runbook attached.
- **Unusual volume.** Robust median/MAD weekly comparisons and same-weekday/hour seasonal baselines.
  Short-lived repeated incidents with one dedup key are reported separately as flapping.
- **Last 7 days.** Aggregate counts (incidents analyzed, findings by kind, ratings, changes recorded,
  stuck work items), visible to administrators only and naming no service or incident.
- **Suggestion quality.** Responder thumbs on similar-incident suggestions, bucketed by match score.
  When there are at least 20 ratings and low-scoring suggestions are mostly unhelpful, it proposes a
  higher minimum similarity, judged by the lower bound of the Wilson interval so a few thumbs-up cannot
  justify a change. It never proposes lowering the threshold. Applying it is a button that publishes a new
  audited global policy version; the suggestion is recomputed on the server and must match what was
  shown, so a stale page or crafted request cannot set an arbitrary value. Aggregate feedback is visible
  only to administrators.

- **Suggested grouping rules.** Learned from what people decided, with no opaque model: links people made
  or accepted are positives, suggestions they rejected or reverted are negatives. Candidates are ordinary
  `LABEL_SET` or `CONTENT_TEMPLATE` rules. The narrowest standard window covering 90% of confirmed gaps is
  chosen; a rule is offered only with at least three supporting links and 80% precision on reviewed
  pairs, and is dropped if a replay over the last 30 days would group more than 30% of incidents. It runs
  on request, read-only and bounded (2,000 decisions, at most 16 candidate patterns, and 5,000 replayed
  incidents per candidate). Cheap evidence nominations rank the shortlist before full scoring and
  replay, with deterministic ties; candidates below three nominations are excluded. The UI explains
  that this sample can omit other patterns. Adopting one publishes a
  new audited global policy version in the current mode; the suggestion is recomputed on the server and
  must still be offered.
- **Weekly digest (opt-in).** Administrators choose a day and UTC hour. Once per ISO week the lane queues
  one `SEND_DIGEST` item; it claims an `IntelligenceDigestRun` row and hands each recipient's email to the
  notification control plane as BULK system mail, so paging traffic is always served first and the
  control plane owns retries and delivery history. Its de-duplication key makes each person's digest
  exactly-once per week, even across replicas or a crash. Recipients are active people who can manage
  intelligence (at most 100), and each digest is built from the services that person can read. A digest
  missed during an outage is sent later that week, never carried into the next, and expires after a day.

## REST API

`GET /api/v2/incidents/{id}/intelligence` returns similar incidents, related incidents, possible changes,
upstream incidents and runbook suggestions. It uses the existing `incidents:read` scope and the same
actor-scoped views as the UI, so it cannot reveal anything the credential could not read; possible
changes additionally need `services:read` and runbook suggestions need `runbooks:read`. The response is
marked advisory and uncalibrated, and is empty in shadow mode. No MCP tools are added here; native MCP
is delivered separately.

## Deployment

The lane runs in the `integrated`, `worker` and `general-worker` roles. A dedicated
`intelligence-worker` role runs only the lane (no scheduler, job worker or runbook worker), so analysis
can be scaled, resourced and failed independently of paging. Its connection pool can be sized with
`DATABASE_POOL_SIZE_INTELLIGENCE_WORKER`, like the other roles; that is process-level infrastructure
configuration, while every behavioural setting remains in the UI.

Every split topology (Compose, Helm, Swarm and Kustomize) runs the dedicated role by default and sets
`OPSKNIGHT_INTELLIGENCE_DEDICATED=true` on the shared worker roles, so the lane never shares a paging
process. Its wake listener uses one additional session connection, accounted for separately from the
Prisma pool. Pool contention is measured through Prisma's local engine metrics without acquiring
another SQL connection; contention pauses the lane and requires two measured quiet samples before
recovery. Paging-lag hysteresis remains independent. Missing pool telemetry is unknown, not a zero
measurement. A single-node `integrated` install runs the lane in a child process of its own
with its own heap and Prisma client; it uses its own small pool and backs off while ingestion is busy
(see "Backpressure and budgets"). A shared process
can therefore use up to `INTELLIGENCE_LANE_DATABASE_POOL_SIZE` more PostgreSQL connections while the
lane is enabled and busy. Size `max_connections` for that, or set the variable lower. Lowering
`maxConcurrency` and `batchSize` in Settings → Intelligence still reduces the lane's share of
PostgreSQL further.

### Scale behaviour

Bounded work is the rule for every background read:

- The metrics scrape reuses one backlog aggregate per process for ten seconds
  (`WORK_BACKLOG_CACHE_MS`); operator pages and tests read fresh.
- Semantic backfill walks the lookback window newest-first in pages of 5,000 fingerprints behind a
  per-model cursor (`findIncidentsToEmbedPage`), checking a service's policy only for rows that are
  actually pending, and restarts from the newest incident once a walk completes.
- The full-text source requires the two rarest words together (`planFullTextQuery`); OR-ing several
  words matched 50x more rows at 100k history and took 4x longer, so recall beyond the conjunction is
  left to the same-service and trigram sources. A title made only
  of common words is left to trigram matching, which would otherwise rank a large share of history.
- Topology reads are ordered by recency with rejected edges outside the cap, and runbook outcome
  ranking has its own `(serviceId, createdAt)` index.
- Three benchmarks are release gates, run nightly and under the `ci:full` label
  (`.github/workflows/intelligence-performance.yml`): the ingestion A/B (`processEvent` p99 at most
  +10 ms and p50 at most +2 ms with the lane busy in the same pool), the storm drain (10k new incidents
  over 1M history in under ten minutes, no dead letters, per-kind p99 under 10 s) and the query-plan
  check (every hot query, including the production claim statement, index-backed). Measured results
  live under `plans/intelligence-engine/certification/perf/`.

## Pre-paging noise controls

`src/lib/intelligence/noise-controls/` decides what happens to an alert before an incident exists:
maintenance windows (one-off or RRULE subset), suppression rules (matchers on source/summary/severity/
resource/labels), orchestration rules (ordered conditions → drop/suppress/transform actions), content
dedup on the alert fingerprint with label subset, flapping keyed on dedup key and fingerprint, storm
grouping under a parent incident with an optional bounded hold, and heartbeat monitors. The contract is:

- **Per-service policy, default OFF, SHADOW before ON** (`NoiseControlPolicy`, revision CAS, audited; ON
  is gated by `assessNoiseReadiness`: ≥ 50 shadow decisions in 7 days and ≤ 2% reversed, or an explicit
  acknowledgement).
- **Versioned like automation rule sets** (`policy-versions.ts`, `versioning.ts`). Each publish appends an
  immutable `NoiseControlPolicyVersion` (mode + definition + sha256 checksum, `versionNumber` dense per
  scope) and points `NoiseControlPolicy.activeVersionId` at it in the same transaction under a per-scope
  advisory lock; a rollback publishes a clone (`origin: ROLLBACK`, `sourceVersionId`). The live row stays
  what the cache reads, so evaluation is unchanged; the snapshot loader also reads the active version's
  `policyRevision` and exposes `versionId` only when it equals the row's `revision`, and the decision row
  stores it as `PrePagingDecision.policyVersionId` (soft reference, no FK). Rows from before versioning, or
  rewritten by an older replica, are captured as `origin: BACKFILL` by
  `backfillNoiseControlPolicyVersions` (keyset-paged, ≤ 5 × 100 rows per sweep tick, idempotent), and
  lazily on publish or history read. Orchestration was kept in noise-controls rather than becoming an
  automation rule-set kind because automation versions carry a different compiled snapshot evaluated after
  the incident exists; reusing them would add a second compiler path to the pre-paging hot path.
- **The hook is bounded and fails open.** `evaluatePrePagingControls` reads only the in-process snapshot
  (`cache.ts`, refreshed every 30 s, previous snapshot keeps serving; a service-level OFF policy
  overrides an active global one) and index-backed lookups under one 5 ms deadline. Static controls
  (windows, rules, orchestration) need no lookups. Any error, timeout or cold cache returns
  `action: 'NONE'`, so the event pages as before. No model, no network.
- **Every decision is recorded and reversible** (`PrePagingDecision`). Reversal re-ingests the alert
  through `processEvent` under a reversal-scoped dedup key so it pages; shadow reversals are the
  false-positive signal for readiness and the false-group KPI.
- **HIGH urgency** is left alone by dedup/flapping/storms unless the policy opts in, and is never held.
- **Heartbeats** raise and resolve incidents only through `processEvent`, from the cron tick
  (`sweepPrePagingControls`), which also retires expired rules and ages out decisions.
- **Simulation** (`simulatePrePagingControls`) replays the real evaluator over recent alerts with
  in-memory lookups and records an evaluation run.
- Post-paging correlation rules gained `allowHighUrgency` (suggest only) and `linkType: 'PARENT_CHILD'`.

### Live ingestion wiring

`processEvent` (`src/lib/events.ts`) calls the controls through `intelligence/ingest-hooks.ts` only,
for a new trigger, after classification and before the incident is written, inside the event
transaction (`noise-controls/ingest.ts`):

1. **OFF (default):** one in-process map lookup; no statement is sent. A cold snapshot fails open
   (`cache_cold`) and starts a background refresh.
2. **SHADOW / ON:** `lookupPlan` derives exactly the reads the evaluator will make;
   `prefetchedLookups` serves them from **one** statement (dedup target, flapping statuses, storm count
   and parent as scalar sub-selects on `idx_alert_service_fingerprint_recent`, `idx_alert_by_service`
   and `idx_incident_sla_by_service`). By default that statement runs on a **dedicated lookup pool**
   (`noise-controls/lookup-client.ts`: two connections per process on the direct route, opened by the
   background snapshot refresh once a SHADOW/ON policy exists) whose connections start with
   `statement_timeout` and `lock_timeout` equal to the deadline: one round trip, and an abandoned or
   failing lookup never touches the event transaction. On this route `processEvent` **sends the
   statement early** (`beginIngestNoiseLookups`): as soon as the event is known to open a new incident,
   after the dedup-key advisory lock and the open-incident check, so it overlaps the resolve-buffer,
   policy, classification and automation reads the transaction makes before the hook. The reason is
   queueing, not the round trip itself: while the hook waits, the event holds its connection from the
   main pool, and with more events in flight than connections every millisecond of hold is paid again
   by each event queued behind it (measured: about 1.5 ms of wait in the hook cost +2.1 to +3.5 ms p50
   at concurrency 16). The hook reuses the answer only for the same event, instant, deadline and
   snapshot object, otherwise it reads for itself; the deadline counts from the moment the statement
   was sent, so the lookup never gets more than one deadline and the hook waits only for the rest. The
   early start reads the same committed state the hook would (the event has written nothing these
   lookups read), a few milliseconds sooner; events for one dedup key still read in order because the
   lock is taken first. It uses `peekPrePagingSnapshot`, so only the hook starts snapshot refreshes and
   cold-cache behaviour is unchanged. A lookup started for an event that then takes the buffered
   out-of-order resolve path, or that a static control (window, suppression rule, orchestration)
   decides, is wasted; it never touches the event. A transaction-pooled (`pgbouncer=true`) or
   missing datasource falls back to the **savepoint route**: the statement is issued lazily inside
   `SAVEPOINT opsknight_prepaging` with `set_config('statement_timeout', <deadline>, true)` and the
   savepoint is always rolled back (restoring the transaction's own timeout and clearing an aborted
   subtransaction). That route costs three round trips inside the deadline and one after it; an
   abandoned lookup delays the event by at most one deadline.
3. **Acting on ON:** suppress → SUPPRESSED incident (no escalation, SLA paused); downgrade/transform →
   effective urgency, restated alert severity/labels, timeline notes (reroute and runbook attachment are
   recorded, not applied); drop → unlinked alert, no incident; append → alert on the open incident,
   urgency only rises; group → OPEN child with no escalation, accepted `PARENT_CHILD` (child → parent)
   with a provenance event, and only `TRIGGER_SERVICE_NOTIFICATION` queued; hold → first page scheduled
   at `holdUntil` (never for HIGH). A vanished append/group target pages normally.
4. **Recording:** SHADOW and ON decisions are written with the alert and incident ids (SHADOW keeps the
   would-be target in `evidence.targetIncidentId`). Reversal re-ingests under
   `noise-controls:ungroup`, which the hook never evaluates, so the reversal always pages.
5. **Child roll-up:** `sendServiceNotifications` resolves a storm child's parent and keys its posts on
   the parent's source with `rollUpParentId`; `decideNotificationNoise` then groups the first and
   suppresses the rest per recipient and minute, whatever the traffic class, so a storm pages once.

`setPrePagingDeadlineMs` overrides the deadline per process (1–50 ms) for tests and benchmarks only.
The A/B gate runs with `--noise-controls on` (every control ON, every lookup executed, no outcome
changed) against everything OFF; results are under `plans/intelligence-engine/certification/perf/`.
**Local status (2026-11-10, lightly loaded shared host):** the hook alone **passes** on the pool route
(+1.14 ms p50 / +0.34 ms p99, limit +2 / +10; savepoint route +3.68 ms p50, FAIL), with 1 in 1,200
evaluations failing open. Every control ON together with the busy lane **fails** on p50 (+4.45 ms; the
lane alone measured +1.61 and +2.41 ms), and the 10k burst over 1M history fails (+12.56 ms p50 /
+17.45 ms p99, 28% fail-open at concurrency 16 on two lookup connections). No ingestion event failed in
any run.
**Local status (2026-11-11, lane in its worker thread, lookups started early, host check with the peak
rule):** every control ON with the busy lane **passes**, 3 of 3 valid invocations (p50 / p99 -0.08 /
-17.62, +0.64 / -13.42, -0.29 / -10.20 ms), and so does the CI shape (3 of 3). The in-process fallback
is outside the contract (it meets the latency limits only because the lane stops during a burst). The
10k burst over 1M history was not re-measured, so keep ON to services where the noise justifies it
until that burst gate passes.

**Lookup pool size and fail-open per route (2026-11-17).** The pool has `PREPAGING_LOOKUP_POOL_SIZE`
connections (1–32) or, by default, a quarter of the process's main pool, 2–8 (3 for the default pool of
10). `opsknight_prepaging_lookups_total{route, outcome}` counts every evaluation that read the database,
by route (`pool` or `transaction`, the savepoint fallback) and `ok`/`fail_open`, so each route's fail-open
rate is a ratio of two series. The integration test `measures fail-open per route at concurrency 16`
(320 evaluations, 5 ms deadline, shared host at load 12–17) found that the 28% at concurrency 16 was not
connections running out: steady-state rounds failed nothing open even on two connections, and 16
connections failed open more than 2–3 because every fresh connection is cold. The misses were the first
rounds on cold connections plus per-query client overhead under a burst. Two cheap fixes followed:

- The pool is warmed once per client with the real prefetch statement (matching nothing), one concurrent
  probe per connection, three passes, from the background snapshot refresh. Pool route after the fix:
  3–20% on 2 connections and 3–14% at the default size across runs (15–28% before, warmed with `$connect`
  only); the spread is host noise.
- The savepoint route opens its savepoint and timeout before the deadline starts, so only the read races
  it: 38–41% fail-open before, 14% after. On that route, an event that matches a static control first now
  pays the savepoint round trips too.

## Triage, change risk, topology and SLO burn (deterministic)

- **Triage** (`triage/predict.ts`, work kind `TRIAGE_INCIDENT`, chained by the similarity analyzer when
  the policy's `triage.enabled` is true): a weighted plurality vote over the incident's resolved
  similar-incident precedents (weight = similarity score) for urgency and owner, a same-template open
  incident on the same service within 24 h as a probable duplicate, and weighted quantiles of precedent
  resolution times as the expected time to resolve. Written as `TRIAGE_*` findings with their own
  snapshots, so freshness applies. Accepting runs `updateIncidentUrgencyDomainCommand`,
  `assignIncidentDomainCommand` or `linkIncidents` (never an intelligence write); every decision is
  `IntelligenceFeedback` for calibration.
- **Change risk** (`changes/risk.ts`, computed in the `LATE_CHANGE` handler): shrunk historical
  follow-rate of the source's changes on the service, saturating blast radius from the reversed dependency
  graph, off-hours/weekend timing, and size labels, blended per change kind into `ChangeEvent.riskScore`.
- **Native change sources** (`changes/mappers.ts`): pure mappers for Argo CD, LaunchDarkly, Unleash and
  HCP Terraform behind the same `createIntegrationHandler` as the generic change endpoint.
- **Topology** (`dependencies/import.ts`, `topology-sources.ts`, work kind `SYNC_TOPOLOGY`): Backstage
  catalogs (JSON or multi-document YAML, 2 MB bound) resolve entities to services by annotation or name and
  declare edges idempotently; sources are pulled through the SSRF-guarded fetch on their own interval, and
  failures are recorded on the source rather than retried. `graph-view.ts` serves the actor-scoped graph.
- **SLO burn** (`lib/slo/burn.ts`): merged incident downtime over 1 h / 6 h against each availability or
  uptime objective's error budget, classified at the usual 14.4 / 6 thresholds. Triage raises (never lowers)
  urgency on a burning service; `rankByBurn` is the hook for grouping anchors.
- **Cause-ranking weights** (`learning/response-weights.ts`): bounded multipliers for change kinds,
  upstream decay and global changes, fitted by coordinate descent from feedback on cause findings and
  offered only when held-out loss improves on the shipped defaults; applied through `response.weights` in
  a policy version.
- **Runbook-ranking weights** (`learning/runbook-weights.ts`, sharing `learning/bounded-fit.ts` with the
  cause fit): `scoreRunbook` in `recommendations/wilson.ts` takes bounded weights for the service-wide
  record (0.5–1), the same-problem record (0.5–1), the MTTR bonus (0–0.3) and a prior for a bound but untried
  runbook (0–0.2, so it never outranks even a 1-of-1 record); the defaults reproduce the shipped Wilson
  ranking exactly. Labels are the latest accept/reject verdict on a `RUNBOOK_RECOMMENDATION` finding and,
  overriding it, the observed outcome of the first run of that runbook on that incident after it was
  recommended (fixed = succeeded and resolved within the fix window, `IntelligenceSettings.runbookFixWindowMinutes`,
  120 minutes by default; not fixed = failed, timed out, or that
  window elapsed unresolved; runs on already-resolved incidents and still-open windows are undecided). Each
  label carries the evidence the ranker stored, so no history is re-derived. The reads start from recent
  feedback and from recently finished executions via `(status, updatedAt)`, are capped at 2,000 rows each
  and run under a 5 s statement timeout. A proposal needs 40 labels, 8 of each verdict and a held-out
  log-loss improvement of 0.01. The fit runs in the intelligence lane at most once a day
  (`scheduleRunbookWeightFit`, called once per lane cycle) and stores its proposal in one
  `IntelligencePattern` row; the insights settings page reads that row and never fits on page open. The
  proposal is recomputed server-side on publish and stored as
  `response.runbookWeights` in a new policy version (absent = shipped ranking; findings ranked with learned
  weights carry `learnedWeights: true`).
- **Impact estimate** (`impact/view.ts`, `IncidentImpactCard` in the **Impact** tab): dependent services
  from `downstreamDistances` over the cached active edges (depth 3, 200 candidates), re-walked over the
  services the viewer can read so a path through a hidden service is never followed; open-incident counts
  under the viewer's incident scope; `StatusPageService` components of those services with
  `Service.status`; and `getSloBurn` for the incident's service with each objective's whole-window budget
  (`objectiveBudgetMinutes`) and the share this incident has used. SLO burn counts every incident on the
  service, so it is returned only to viewers with `metrics.read.all` (the shared-objective-history rule).
  Every query is capped; the card is a lazy server component that renders nothing on failure and the shared
  `EmptyState` when nothing applies.
- **Time axis** (`timeline/service.ts`): alerts, changes, upstream incidents and noise decisions (read
  tolerantly, since the noise layer may not be migrated) relative to onset, under the viewer's read rules.
- **Shift handoff** (`handoff/summary.ts`, `handoff/dispatch.ts`, called from `oncall-handoff.ts` at each
  rotation when `handoffSummaryEnabled`): deterministic summary delivered through the notification control
  plane (de-duplicated per recipient and shift) with an optional AI narrative charged to the recipient.

## Incident page placement: strip and insights inspector

Core incident data (title, status, actions, description, notes, alerts, responders, timeline) keeps its
position. Intelligence is summarised in one row and expanded on demand; nothing intelligence-related is
rendered between the description and the core tabs.

- **One read.** `loadIncidentInsights` (`src/lib/intelligence/incident-ux/strip.ts`, wrapped per request by
  `incidentInsightsForRequest`) composes the existing view functions (`analysis/view`, `memory/proactive-view`,
  `triage/view`, `similarity/view`, `correlation/view`, `incident-ux/group-view`, `response/view`,
  `impact/view`, `incident-ux/list-badges`). It adds one scoped incident lookup (`incidentReadWhere`) and no
  other query; every view keeps its own `take` caps and read scope. Each part is fail-soft: a failing view is
  logged and treated as "nothing to show". The strip, the hero group line, the suggested-runbooks group and
  every inspector section render from this one result.
- **Mode and permission.** Requires `INTELLIGENCE_SUGGESTIONS_READ` and a readable incident. Service mode
  `OFF` returns `null` for responders, so no strip, chip, group line, timeline overlay or inspector exists.
  Holders of `INTELLIGENCE_MANAGE` get a reduced result (`mode: 'OFF'`, accepted links and the storm group
  only) so the inspector can state that intelligence is off and a grouping made earlier can be undone.
- **`IntelligenceStrip`** (server component, directly under `IncidentCommandBar`): `buildStripChips` emits a
  chip only when it has content (triage, similar, likely cause, noise state, impact, briefing); an empty
  strip renders nothing. Chips are links carrying `data-insights-open="<section>"`. `FreshnessDot` is the
  single freshness indicator (WAITING, STALE, PAUSED, FAILED, UNAVAILABLE); it polls
  `/api/intelligence/incidents/:id/analysis` and offers refresh to managers. It replaces every former
  `IncidentAnalysisNotice` placement.
- **`IncidentInsightsInspector`** (client, `next/dynamic` from `InsightsInspectorHost`, fetched on first
  open): a `Sheet` on the right (`sm:max-w-xl` by default, not modal on desktop, width stored in
  `localStorage` under `opsknight.insights.width`), a modal bottom sheet below 640 px and on the mobile
  route. Sections in fixed order: Briefing, Triage, Similar, Related/Group, Why, Runbooks, Impact, Summary;
  the section bodies are server-rendered (`InsightsSections`) and passed through as children, so only the
  shell is client code. Opened by a chip, by `I` (registered in `src/lib/keyboard-shortcuts.ts`, category
  "Incident Triage", ignored inside the `G` `I` chord and while typing), by `?insights=<section>` and by
  `#finding-<id>`. Items carry stable anchors `id="finding-<id>"`.
- **Ask Squire about this.** Every item calls `openSquire({ question, evidence, incidentId })` on the
  squire bus (the contract under "Assistant (Squire)"): the question is placed in the composer, not sent,
  and the `evidence` handle (`kind`, `id`, `label`) becomes the launcher's "About" chip, which links back to
  the item's `#finding-<id>` anchor. A whole section (briefing, group, impact) passes the incident id as
  `id`, and the chip links to the section. The standalone Ask Squire card is removed.
- **Beside a docked assistant.** The desktop inspector is offset by `--squire-dock-width`, so a docked
  Squire and the inspector sit side by side instead of overlapping.
- **Timeline.** The intelligence time axis (`timeline/service.ts`, mapped by
  `incident-ux/timeline-overlay.ts`) is an overlay on the core Timeline tab behind "Show intelligence
  events" (on when any exist) with an "Intelligence" filter. There is no separate intelligence timeline.
- **Runbooks.** Recommended runbooks with their success rate are the "Suggested for this incident" group at
  the top of the core Runbooks tab; the inspector's Runbooks section links there.
- **Group line.** A storm parent or child gets one line under the title (`incident-group-line`); the full
  group view with ungroup controls is the inspector's Related/Group section.
- **Summary.** Lives in the inspector with "Post summary as note"; the notes composer's "Insert summary"
  drafts the same summary into the composer through the same server action.
- **Mobile.** `/m/incidents/[id]` renders the same strip (horizontally scrollable) and the same inspector
  as a bottom sheet. The separate mobile intelligence card is removed.

## Placement: service, team, dashboard and wallboard surfaces

Read-only surfaces that put existing intelligence data where people already look. All loaders live in
`src/lib/intelligence/surfaces/`; none adds schema, a job or a write path (the one mutation, reviewing a
suggested dependency, calls the existing `dependencies/service.reviewDependency`). Every surface renders
nothing when it has nothing to show.

- **Service Intelligence tab** (`surfaces/service-intelligence.ts`,
  `src/app/(app)/services/[id]/intelligence/`, `src/components/service/intelligence/`).
  `resolveServiceIntelligenceAccess` is the single gate: an active actor with `intelligence.read` and a
  service inside `serviceReadWhere`. It also resolves the effective intelligence mode and the effective
  noise-control mode (the service's own row, else the global row, else OFF); when both are OFF and the
  viewer lacks `intelligence.manage`, `visible` is false and the page does not offer the tab. The tab's
  component is only rendered while `?tab=intelligence` is selected, behind its own `Suspense`, so other
  tabs issue none of its queries. Sections load in parallel through `overview/scope.loadSection`
  (fail-soft, one-line error per section):
  - dependency neighbourhood: the same rows as the topology graph (`dependencies/graph-view`) cut to
    edges touching the service, at most 24 ACTIVE and 24 SUGGESTED, neighbours re-checked against
    `serviceReadWhere` (an edge to an unreadable service is dropped), open-incident overlay under
    `incidentReadWhere`; four queries regardless of edge count. Drawn as server-rendered SVG
    (`ServiceDependencyGraph`, no client JavaScript, hidden below `sm` where the list is the view);
    suggested edges are dashed and labelled. Approve/reject is `reviewServiceDependencyAction`
    (`intelligence.manage`; the edge must be SUGGESTED, touch the viewed service and join two readable
    services);
  - SLO burn (`slo/burn.getSloBurn`), alert quality (the leaderboard's window, thresholds and
    `scoreAlertQuality`, as one aggregate for one service), recent changes with the stored `riskScore`
    (8 rows, 14 days), noise status (`getNoiseControlKpis` for the service, maintenance windows active now
    via `isWindowActiveAt` for SERVICE/TEAM/ALL scopes, enabled heartbeat monitors), the AUTO gate
    (`evaluation/quality.getAutoGate` for the effective policy), recurring problems
    (`insights/service.recurringProblems`) and the count of confirmed service facts.
- **Service list badges** (`surfaces/service-list-badges.ts`): maintenance active, SLO burning, noise
  ON/SHADOW for one page of services. Gated on `intelligence.suggestions.read` and re-scoped with
  `serviceReadWhere`, so a scoped user gets badges only for their teams' services. Five queries for the
  whole page whatever its size (readable services, noise policies, maintenance windows, objectives,
  incidents overlapping the six-hour burn window); the burn maths reuses the pure functions of
  `slo/burn`. Fails soft to no badges.
- **Team tiles** (`surfaces/team-tiles.ts`): AI usage today against the team's enabled budget
  (`ai/cost.getBudgetStatuses`) plus a seven-day total from `AiUsageBreakdownDay`, and noise load
  (`getNoiseControlKpis` over the team's readable services, at most 500). Requires `intelligence.read`
  and a readable team; each tile is null when silent.
- **AIOps pulse** (`surfaces/dashboard-pulse.getAiopsPulse`, rendered as the last row of the Ops Pulse
  panel): pages avoided in 24 h (applied, unreversed ON decisions), open groups (open incidents with an
  accepted `PARENT_CHILD` child, under `incidentReadWhere`), triage findings awaiting review (ACTIVE
  urgency/assignment/duplicate findings from the last 7 days on open readable incidents with no feedback
  row, counted up to 1,000) and, for `intelligence.manage` only, quarantined work items. Each probe
  fails soft to zero; the loader returns null when every number is zero, and the page then renders no
  tile.
- **Wallboard largest open group** (`surfaces/dashboard-pulse.getWallboardLargestGroup`): one `groupBy`
  over accepted `PARENT_CHILD` links whose parent is open and readable, plus one read of the parent.
  Rendered beside `WallboardNoiseTile`; null when no group is open.

The orphaned `src/components/DashboardAnomalyDetection.tsx` was removed; rate anomalies are surfaced by
the insights pages.

## Fault tolerance

Every failure is contained to the smallest unit that can fail, and every repair path is bounded:

- **Handlers are abortable.** Each work item runs inside an `AsyncLocalStorage` abort scope
  (`jobs/db-budget.ts`); when its budget expires, the statement running in any budgeted transaction it
  opened is cancelled from another connection (`pg_cancel_backend`), and the backend is terminated a
  second later if it has not let go. A handler that is still running after its timeout stays counted
  against `maxConcurrency` (`LaneState.timedOut`), so the lane can never run more database work than the
  operator allowed; while every slot is held it claims nothing and reports `saturated`.
- **Leases are renewed before late starts.** Items at the tail of a batch renew their lease before they
  run, so a slow batch never has the same item running on two workers.
- **Poison is quarantined, outages are not.** A dead letter signalled again after 30 minutes gets one more
  round of attempts; one that dies a second time within 24 hours is quarantined (`quarantinedAt`), never
  revived or purged automatically, and waits for an operator replay. A per-kind breaker
  (`jobs/kind-breaker.ts`) pauses a kind whose handler fails for most of its items over five minutes,
  for five minutes, while every other kind continues; the claim query excludes paused kinds.
- **Lost signals are repaired in O(changes).** `reconcileUpdatedIncidents` walks `Incident.updatedAt`
  from a watermark every cycle, so any change whose wake hint was lost is re-indexed within a cycle or two
  regardless of history size. The recent-history sweep (`reconcileFingerprints`) is paced at ten minutes
  and covers engine-version drift and policy placeholders. Publishing a policy enqueues a bounded
  re-index of the scope's open incidents; the policy identity is part of the analysis input hash, so only
  analyses the policy changes fan out.
- **Huge incidents bootstrap in passes.** A full alert (re)build reads at most 5,000 payloads per pass
  (`MAX_BOOTSTRAP_ALERTS_PER_PASS`), stores its digest, label union and cursor with `alertIndexPartial`,
  and the handler re-signals the same item; analysis is chained only when the last pass completes.
- **Retention always progresses.** Each table is one short transaction under its own budget; the alert
  fingerprints of expired incidents are drained in bounded bites before their parent rows, so a cascade
  can never explode; a failing table is reported (`failedTables`) without stopping the others, and the
  runner halves the batch until sweeps are clean. Replicas coordinate through a database lease row, not a
  transaction-long lock.
- **Replicas.** Only the holder of a session advisory lock (the wake leader) turns notifications into
  work; discovery, the sweeps, retention and the dependency observer are single-holder, and the observer
  does not spin when another replica holds its lock. HNSW index builds check `pg_stat_progress_create_index`
  before touching an index another replica is building.
- **Clocks.** Discovery bounds, the repair sweeps and the queue use the database clock (`dbNow`), so
  application clock skew cannot make them skip or repeat work.
- **Visibility.** `opsknight_intelligence_lane_up` exists from the first scrape and vanishes with the
  process; the cycle age counts from lane start, so a lane wedged before its first cycle is reported.
  Health stays `degraded`, never `unhealthy`, so a wedged lane can never pull a replica out of rotation.
- **Indexes.** `scripts/repair-invalid-indexes.cjs` runs at container start and rebuilds any index left
  INVALID by an interrupted concurrent build, which `IF NOT EXISTS` would otherwise skip forever.

## Observability

`/api/health?mode=readiness` includes an `intelligence` check that is `healthy`, `degraded` (paused to
protect paging, or no recent cycle) or `disabled`, and is never `unhealthy`, so an optional advisory
lane can never take a replica out of rotation. Five gauges are added to the metrics scrape: ready
queue depth, oldest ready age, dead letters, lane paused, and seconds since the last cycle. Work items and
AI calls emit OpenTelemetry spans (`intelligence.work`, `intelligence.ai.generate`,
`intelligence.ai.stream`) through the OpenTelemetry API, which is a no-op until a tracer provider is
registered. Span attributes are bounded categories and token counts; never incident ids, prompts,
answers or error messages.

## Lists, overview inbox and mobile entry

- **Alerts list** (`/alerts`, `lists/alerts.ts`): a keyset walk of `Alert(createdAt)` (or
  `(serviceId, createdAt)`) inside a 24 h / 7 d / 30 d window, 50 rows a page, cursor
  (`<createdAt base36>.<id>`) in the URL. Scope is `serviceReadWhere(actor)` and, when the alert has an
  incident, `incidentReadWhere(actor)`. The noise decision for each row is read from
  `PrePagingDecision(serviceId, createdAt)` restricted to the page's services, time span and alert
  ids; an applied decision wins over a shadow one and reversed decisions are ignored. With a decision
  filter the walk runs over `PrePagingDecision(createdAt)` instead and the alerts are read by primary
  key, so such a page can be shorter than 50 rows.
- **Changes list** (`/changes`, `lists/changes.ts`): the same walk over `ChangeEvent(occurredAt)`.
  A global reader sees every change; a team-scoped reader sees changes of their teams' services.
  Linked incidents come from the readable incidents opened between the page's oldest change and 24 h
  after its newest (capped at 500), joined to `CHANGE_CORRELATION` findings through the finding lookup
  index. Risk bands (`lists/contract.ts`) are shared with the overview's change panel.
- Both loaders run inside one `withDbBudget` transaction (4 s) and the pages render the failure as a
  notice. URL parameters are parsed in `lists/contract.ts`; anything unrecognised falls back to the
  default view. Both pages assert `INTELLIGENCE_READ`.
- **Needs-attention inbox** (`overview/attention.ts`): independent, fail-soft probes, each capped at
  200 rows and a seven-day lookback: undecided triage findings and `SUGGESTED` relationships on open
  readable incidents (only for services whose effective mode is SUGGEST or AUTO), services whose AUTO
  gate passes while in SHADOW or SUGGEST, `SUGGESTED` dependencies and quarantined work. The last
  three require `INTELLIGENCE_MANAGE`. The section renders nothing when empty or unavailable.
  Connector test results are not persisted, so failing connectors are not listed.
- **Mobile**: `/m/intelligence` renders the inbox and the Noise section from the same loaders.

## Expanded roadmap

Service-certified reversible AUTO links and confirmed Squire write actions are implemented.
Pre-paging noise controls are wired into live ingestion (default OFF). External observability
connectors, expanded agent actions, triage predictions and the responder overview are still tracked
as work in progress in `plans/intelligence-engine/roadmap-implementation.json`. Implemented code and
local evidence are distinct from deployment certification; synthetic checks do not certify a
production service.

## Quality and automatic grouping

Full-text retrieval ANDs the two most informative query terms before ranking; same-service and
trigram tiers preserve recall. Engine version 1.3.0 combines IDF-weighted token and trigram signals, uses semantic evidence to raise
lexical matches, and enforces a content floor before contextual weights. Weight training is offline;
a person adopts a recomputed proposal through an audited, revision-locked policy publication.
Topology rules follow active dependency components and enforce their content minimum. Change ranking
scores the whole indexed six-hour window before taking top results, with source-frequency and component
agreement adjustments. Outcome patterns are updated transactionally and idempotently on reindex,
reopen, title change and suppression. Runbook ranking uses resolution after execution and per-template
outcomes/MTTR. Insights use seasonal median/MAD comparisons and short-lived dedup-key flapping episodes.

Settings → Intelligence → Evaluation & spend → Grouping quality measures explicit human-reviewed pairs over 30 days, capped at 2,000.
Unreviewed pairs never become negative labels. A service certification requires at least 200 predictions,
20 negative labels and 20 critical labels; precision ≥98%, its Wilson lower bound ≥95%, false merges ≤1%,
recall ≥50% and zero critical false merges. Each enabled rule needs 100 passing predictions; topology
additionally needs cross-service evidence. Certification pins the definition, engine and active graph,
expires after seven days and invalidates on later human decisions. Measurement never switches mode.

Only an explicitly published service AUTO override can create automatic accepted RELATED children of
an open group. HIGH, resolved and old incidents are excluded. Pending initial paging defers intelligence
work without changing the paging job. Creation, anchor re-election and undo retain decision history;
a human rejection or reversal vetoes automatic reapplication. No paging hold or notification suppression
is implemented. These runtime quality gates do not replace deployment/load/security certification.

## Feature operational telemetry

Embedding, weekly digest and confirmed-action health use label-free cluster gauges in the typed
operational metric registry. A frequent scrape reads capped semantic backlog without counting all
vectors or making a provider call. Daily embedding allowance includes settled usage and live holds.
Digest aggregates cover eight recent runs within seven days; action outcomes cover 5,000 recent
receipts within 24 hours. SQL returns counts/ages only, with a 750 ms aggregate-query budget.
Sample truncation and unavailable probes have explicit gauges. Independent probe failures omit only
their own group, log fixed category names and never affect application readiness. Sustained operator
warnings distinguish actual pending work, exhausted allocations, failed sends and uncertain writes;
uncertain actions remain owner-only and are never automatically resumed or retried. Metric replica
aggregation uses `max` because these are shared-database snapshots. Production alert calibration is
still an external certification gate.

## Operations insights

Operations insights (Workstream J) are what deterministic code notices about one **scope**: a service, an
escalation policy, an on-call schedule, a runbook, a person or a team. They are computed in the
intelligence lane, stored, and only ever read by pages. They suggest; a person acts through the feature's
own editor. Nothing here runs on `processEvent`, the escalation worker or notification dispatch, and no
model is called (`tests/architecture/intelligence-boundaries.test.ts` asserts all three).

Everything is off after upgrade. `IntelligenceSettings.opsInsightsEnabled` is the master switch and each
area has its own (`opsInsightsAutomationEnabled`, `…EscalationEnabled`, `…OnCallEnabled`,
`…PostmortemsEnabled`, `…RunbooksEnabled`, `…NotificationsEnabled`). They are saved through
`updateOpsInsightSwitches`, which goes through `updateIntelligenceSettings` (revision check and audit).
The general settings form does not carry these switches, and a save that omits them leaves them unchanged.
The lane itself still needs Intelligence to be enabled.

### Storage

| Table                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpsInsight`              | One insight. Unique on `(scopeType, scopeId, kind, key)`, so recomputation updates a row. Holds `area`, `severity` (`INFO` < `WARNING` < `CRITICAL`), `title`, `summary`, `evidence` (JSON, at most 4 KB: up to 12 facts, 5 examples, a window), optional `draftHref` (in-app path), `inputHash`, `status` (`OPEN`, `ACCEPTED`, `DISMISSED`, `RESOLVED`), `generation`, first/last seen, who decided. |
| `OpsInsightScopeState`    | Per scope: the hash of the producers' inputs and when the scope was last computed.                                                                                                                                                                                                                                                                                                                    |
| `MetricRollup` (existing) | Daily operations rollups, with the new nullable `subjectKey` column and `idx_metric_rollup_subject (name, subjectKey, bucket)`.                                                                                                                                                                                                                                                                       |

Status rules (`ops-insights/store.ts`, `upsertInsights`): a produced insight keeps a person's decision
(`ACCEPTED` and `DISMISSED` are sticky while it is still produced); an open or accepted insight that is no
longer produced becomes `RESOLVED`; a resolved insight that comes back is `OPEN` again. Writes are fenced on
the work item's generation. Retention (`purgeOpsInsights`, part of the intelligence retention sweep)
removes resolved and dismissed insights older than the finding retention, and insights, scope state and
per-person page counts whose scope row no longer exists.

### Lane job

`WORK_KINDS.OPS_INSIGHTS` (priority 60, the lowest) has one work item per scope, subject
`SCOPE_TYPE:scopeId`. `runOpsInsights` runs every active producer of that scope in one `withDbBudget`
transaction:

1. confirm the scope row exists (otherwise delete its insights and state);
2. call each producer's `loadInput`, hash all inputs with their kinds and versions;
3. if the hash equals `OpsInsightScopeState.inputHash`, stamp `computedAt` and stop: nothing is derived or
   written;
4. otherwise call each `derive`, `upsertInsights` per kind, resolve kinds that are no longer active, and
   store the new hash.

Scheduling: once per lane cycle `scheduleOpsInsightsWork` returns immediately unless 15 minutes have
passed; then, for each scope type that has an active producer, it reads up to 200 scopes that were never
computed or were computed more than a day ago (`dueOpsInsightScopesSql`, a primary-key anti-join) and
enqueues them at a random moment inside the next 15 minutes. That is about 19,000 scopes per type per day.
`enqueueOpsInsights(scope)` enqueues a scope immediately after a relevant edit; it costs one settings read
and one upsert, queues nothing while the feature is off, and must only be called from edit paths.

### Producer contract

A kind is one file under `src/lib/intelligence/ops-insights/producers/` exporting an
`OpsInsightProducer`, plus one line in `producers/index.ts`:

```ts
export interface OpsInsightProducer<Input> {
  kind: string; // stable and namespaced, e.g. 'integration.health'
  version: number; // bump when derive changes its answer for the same input
  area: OpsInsightArea; // which switch turns it on
  scopeType: OpsInsightScopeType; // SERVICE | POLICY | SCHEDULE | RUNBOOK | USER | TEAM
  loadInput(scope, ctx: { tx; now }): Promise<Input | null>;
  derive(input: Input): OpsInsightItem[];
}
```

Rules:

- `loadInput` is the only half that touches the database. Use `ctx.tx` (statement and lock timeouts already
  apply), a fixed number of statements, every one index-backed and capped by `LIMIT` or reading a rollup.
  Never one query per row. Return a small JSON summary, or `null` when there is nothing to judge.
- Everything `derive` depends on must be in that summary, including time. Express ages as coarse numbers
  (whole hours or days, capped), because unchanged summaries are skipped.
- `derive` is pure: no clock, no database, no model, no network. This is what the unit tests exercise.
- Each item has a `key` (unique within the kind and scope), a severity, a title of at most 140 characters,
  a summary of at most 400, and evidence. Items that break the contract are dropped, as are items beyond 25
  per kind (highest severity kept).
- `draftHref`, if set, is an in-app path to a pre-filled editor or draft. A producer never writes, publishes
  or notifies.
- Export the SQL as a function when it is not trivial, and add it to
  `tests/load/intelligence-query-plans.ts`.

#### Worked example: integration health

`producers/integration-health.ts` (scope `SERVICE`, area `automation`) answers three questions from the
alerts a service already stored:

| Key                | Fires when                                                                                                                                                                                                           | Severity                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `silent`           | The service sent at least 7 alerts in the week before its last one, and has now been quiet for a day or three of its usual gaps, whichever is longer. Stops after 30 days (probably retired).                        | `WARNING`                     |
| `volume-step`      | The last 24 hours hold at least 50 alerts and three times the daily average of the 7 days before (needs 35 alerts in that week), or a quarter of it or less (needs 140). Not judged when a count hit its 20,000 cap. | `WARNING` up, `INFO` down     |
| `missing-severity` | Half or more of the last 200 alerts (at least 20) have no severity.                                                                                                                                                  | `WARNING` at 90%, else `INFO` |

`loadInput` is two statements, every arm on `idx_alert_by_service (serviceId, createdAt)` with a `LIMIT`, so
a service with millions of alerts costs the same as a small one. It returns
`{ silentDays, silentHours, weekBeforeLastAlert, last24h, priorWeek, capped, recentSampled,
recentMissingSeverity }`; `silentHours` is exact for the first three days and whole days afterwards.
`derive` turns that into the items above, each with its facts and a `draftHref` to the service's
integrations page. Tests: `tests/lib/intelligence/ops-insights.test.ts` (pure half) and
`tests/integration/intelligence/ops-insights.test.ts` (fixtures with known answers).

#### On-call load and fairness (J3)

Area `onCall`, two producers in `producers/oncall.ts`, logic in `src/lib/oncall-load/`:

- **Capture.** `OnCallCoverageDay (scheduleId, date, userId, layerId, seconds)` is the daily history of who
  was effectively on call (from `getFinalScheduleBlocks`, so after overrides), `date` being the calendar day
  in the schedule's time zone (DST days count their real length). The `OPS_INSIGHTS` handler captures a
  `SCHEDULE` subject's finished days before running its producers (`captureScheduleCoverage`, resumes from
  the last captured day, at most 30 back, never rewrites a day), so history survives layer edits and
  deletes. `layerId` is a plain id for the same reason. `scripts/backfill-oncall-coverage.ts`
  (`npm run backfill:oncall-coverage`) fills 30 days for every schedule in resumable batches.
- **Load.** `loadScheduleLoad` and `loadMyOnCallLoad` read the `ops.pages.user_hour` rollup
  (`queryOpsRollup` with `subjectKeys`, on `idx_metric_rollup_subject`) and the coverage snapshot (unique
  key, or `OnCallCoverageDay_userId_date_idx`), never raw `Notification` rows. `computeLoad` (pure) gives per
  person: pages, night pages (22:00 to 07:00 in the person's time zone, read from the rollup's local hour),
  weekend pages, interrupted hours, longest quiet gap, on-call hours, pages per on-call week and its ratio to
  the rotation mean; per rotation: total, mean and Jain's fairness index. The window is the last 28 finished
  UTC days. Shortcut: pages are per person, not per schedule (a notification does not record its schedule),
  so someone on two rotations counts their pages in both.
- **Scope.** Per-person rows go through `readableOpsInsightScopes(actor, 'USER', ids)`: self, owners of a
  team the person belongs to, administrators. Rotation totals are withheld when the viewer cannot see every
  row and the rotation has fewer than three people (the totals would reveal the other person).
- **Insights.** `oncall.schedule` (scope `SCHEDULE`): `gap` (no one on call for part of a day in the next 14
  days, critical within two days; same rule as `ScheduleHealthCheck`), `same-person` (the policy step after
  this schedule pages someone already on call here), `unfair` (someone above 1.5x the mean; needs three
  people and eight pages). Schedule evidence holds counts only, never names. `oncall.person` (scope
  `USER`): load above 1.5x the rotation mean (one item per schedule), `night` (night pages on at least six
  nights across three of the four weeks), `upcoming` (shift starting within 24 hours on a service with a
  risky change scored at least 0.6 in the last day, a burning SLO or a maintenance window ending; from
  `loadShiftRiskSignals`). The handoff summary (`handoff/summary.ts`) shows the same signals to the incoming
  person as a heads-up while the area is on.
- **UI.** "Load & fairness" tab on the schedule page (`ScheduleLoadPanel`, own Suspense boundary, only
  while the area is on; reference screen `ScheduleCoverageExplorer`), "My on-call load" card on `/schedules`
  and `/m/schedules` (`MyOnCallLoadCard`, renders nothing without on-call time or pages), `InsightBadge` on
  the schedules list via `countOpenInsightsForScopes`. `HeatStrip` is self-contained (Tailwind only).
- Tests: `tests/lib/oncall-load.test.ts`, `tests/integration/oncall-load-store.test.ts` (known answers,
  scoping, lane capture, query plans), `tests/components/schedules/oncall-load-ui.test.tsx`.

#### Postmortems (plan J4)

`producers/postmortem-repeat-cause.ts` (scope `SERVICE`, area `postmortems`, kind
`postmortem.repeat-cause`) fires when a problem (`IncidentFingerprint.template`) recurred at least twice on
the service in 90 days while an unfinished action item of any occurrence is past due. `CRITICAL` when the
problem was seen 3+ times and an item is high priority or 30+ days late, else `WARNING`. `loadInput` is two
statements: problems from the newest 5,000 fingerprints on `idx_incident_fingerprint_service_recent`, then
overdue items through `idx_incident_fingerprint_problem` and `ActionItem (incidentId, status)`, each with a
`LIMIT` (both in the query-plan gate). The stored insight holds counts, days and ids only; example links
resolve text under the viewer's read rules.

On read (`src/lib/intelligence/postmortems/loaders.ts`, never in ingestion), behind the same area switch and
`INTELLIGENCE_SUGGESTIONS_READ`, every related row filtered by `incidentReadWhere`, `postmortemReadWhere` and
`runbookReadWhere`:

- `getPostmortemRecurrenceForActor`: earlier occurrences of the same template in 90 days (capped at 100,
  `idx_incident_fingerprint_problem`), the newest readable postmortem among them and their open action
  items (cap 100, shown 10). Rendered by `PostmortemRecurrenceStrip`; `src/components/incident/IncidentRecurrence.tsx`
  is the server component the incident insights inspector mounts.
- `getPostmortemAssistForActor`: recurrence plus the evidence for the draft (Intelligence time axis,
  change and upstream-incident correlations with responder-confirmed flags from `IntelligenceFeedback`,
  at most 20 runbook runs, fixes of similar incidents) and `suggestActionItems`, deduplicated against open
  action items of this incident and earlier occurrences by word overlap (`findDuplicateActionItem`).
- `generatePostmortemDraft` applies the evidence with `applyEvidenceToDraft` (pure, `evidence-draft.ts`);
  off or failing, the template draft is returned unchanged. The AI draft stays on `cachedGenerateStructured`.
- `checkPostmortemQuality` (`quality.ts`, pure, runs in the editor): missing or placeholder root cause, no
  action items, open items without owner or due date, timeline gaps over 30 minutes inside the incident.

Tests: `tests/unit/intelligence-postmortems.test.ts`, `tests/components/postmortem-intelligence.test.tsx`,
`tests/integration/intelligence/postmortem-intelligence.test.ts`.

#### Runbooks (plan J5)

Area `runbooks`, switch `opsInsightsRunbooksEnabled`, fix window `runbookFixWindowMinutes` (5 to 1440,
default 120, the same rule the runbook ranker and the weight fit use). Pure logic is in
`src/lib/intelligence/runbook-health/` (`insights.ts`: rollup readers, effectiveness with 95% Wilson lower
bounds and the RUNBOOK insights; `notes.ts`: note clustering, imperative-step extraction and the draft
runbook), producers in `ops-insights/producers/`, and the scoped readers in `runbook-health/view.ts`.

- `runbook.health` (scope `RUNBOOK`) reads the runbook by primary key, its latest run on
  `idx_runbook_execution_runbook_recent` (new: `RunbookExecution (runbookId, completedAt DESC)`), 90 days of
  `ops.runbook.run` and `ops.runbook.step_outcome`, and for missing steps the latest 50 successful incident
  runs and their incidents' notes within a day of each run (at most 300). Keys: `fails-often` (at least 5
  runs, Wilson lower bound of the failure rate at least 0.25, critical from 0.5), `unused` (published, no run
  in 90 days), `step-failing:<stepKey>` (more than 30% of at least 5 runs, with the top error code),
  `step-retried:<stepKey>` (a retry in every one of at least 3 runs), `missing-step:<signature>` (the same
  note after at least 60% of at least 3 runs).
- `runbook.missing` (scope `SERVICE`) reads the service's latest 300 resolved fingerprints in 90 days on
  `idx_incident_fingerprint_service_recent`, their `MANUAL_RESOLVED` events and runbook runs on those
  incidents; a masked title with at least 3 similar resolution notes and no runbook run becomes one insight,
  keyed by the template hash.
- Stored evidence holds counts and `/incidents/<id>#note-<id>` or `#event-<id>` links only. On read,
  `resolveNoteRefs` fetches the note text by primary key joined through `incidentReadWhere(actor)`, so a
  viewer sees only the notes of incidents they may open; a suggestion whose notes are all hidden keeps its
  counts and cannot be drafted.
- **Open a draft in the editor** (`services/[id]/runbook-suggestion-actions.ts`, `runbook.manage`) turns
  the readable notes into an unpublished, unbound runbook of manual steps (`draftRunbookFromNotes`) and
  redirects to its editor. Nothing executes or publishes.
- Publishing a runbook version enqueues its `RUNBOOK` scope (`enqueueOpsInsights`); otherwise the daily
  schedule applies.
- UI: the **Health** section on the runbook page (`RunbookHealthSection`, streamed in a `Suspense`
  boundary, hidden on any error), `InsightBadge` on runbook cards from `countOpenInsightsForScopes`, and
  **Suggested runbooks** on the service's Runbooks tab. None of them calls a model.

Tests: `tests/unit/intelligence-runbook-health.test.ts`, `tests/integration/intelligence/runbook-health.test.ts`
(a step failing 4 of 6 runs with `E_TIMEOUT`, fix window 120 vs 600, follow-up notes, three manual
resolutions, switch off, an out-of-team responder, the lane weight fit) and
`tests/components/intelligence/runbook-health-ui.test.tsx`.

#### Notification noise (plan J6)

`producers/notification-noise.ts`, area `notifications`, reads only the two pages rollups below, never raw
`Notification` rows:

| Kind (scope)                             | Key                     | Fires when                                                                                                                                                                                                             | Severity  |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `notification.noise` (`USER`)            | `low-value:<serviceId>` | Over 30 complete UTC days a service paged the person 5+ times and they acted on 20% or less, or 50%+ of the pages were for incidents auto-resolved within 5 minutes. At most 5. Draft: `/services/<id>/notifications`. | `INFO`    |
| `notification.noise` (`USER`)            | `quiet-hours`           | Quiet hours off, 5+ pages between 22:00 and 07:00 local, 20% or less acted on. Draft: quiet hours.                                                                                                                     | `INFO`    |
| `notification.noise` (`USER`)            | `endpoint:<channel>`    | An endpoint is `DEGRADED` (`WARNING`), `INVALID`, `BOUNCED` or `OPTED_OUT` (`CRITICAL`). Draft: notification settings.                                                                                                 | as stated |
| `notification.service_noise` (`SERVICE`) | `low-value`             | The low-value test over everyone the service paged, from 20 pages.                                                                                                                                                     | `INFO`    |

`USER.loadInput` is two statements (the person's rollup rows on `idx_metric_rollup_subject`, the person and
their endpoints by primary key); `SERVICE.loadInput` is one. Stored titles and evidence name no service: a
team owner may read a person's insights without being able to read every service that paged them, so the
service is only an id in the draft link. The personal report (`src/lib/notification-noise/loader.ts`,
`loadNoiseOverview`) is gated by `readableOpsInsightScopes(actor, 'USER', ...)` (self, owner of one of the
person's teams, administrators), reads `ops.pages.user_service` for the person, resolves service names
through `readableOpsInsightScopes(actor, 'SERVICE', ...)` and lists the stored insights with
`listInsightsForScope`. The UI is the "Noise" section (`NoiseSettings` server entry, `NoiseSection` on the
profile Notifications tab, `MobileNoiseCard` on mobile More) with suggestions rendered by `InsightsPanel`.

**Acknowledgement capture.** `Notification` gains nullable `ackedAt`, `ackedVia` and `escalationStepIndex`
(expand-only migration `20261113060000_notification_ack_capture_and_bundling`). When an acknowledgement
arrives through a page, `applyIncidentLifecycleCommand` stamps that one notification inside the existing
acknowledgement transaction (`ackedNotification`, one primary-key `updateMany` guarded by incident, user and
`ackedAt IS NULL`): the voice gather route and the push action (the service worker sends
`X-OpsKnight-Notification-Id`) do this today; `SMS` and `LINK` are accepted values for when an SMS-reply or
per-page link acknowledgement exists. Escalation pages record `escalationStepIndex`. This is the only write
the slice adds to the acknowledgement path; `processEvent` and the escalation decision are untouched.

**Bundling.** `User.bundleLowUrgencyPages` (default false) is read by the existing recipient query when
escalation builds page intents. For an opted-in recipient and a `LOW`-urgency incident that is not P1/P2, the
intent carries `bundle` at `RESPONDER` priority; `isBundleCandidate` in `notification-noise-controller.ts`
still refuses `RESPONDER_CRITICAL` and `TRANSACTIONAL` traffic and roll-ups. The first page per channel in
a 5-minute window is delivered, the next is held to the window end and stands for the bundle, later ones
are suppressed while that held page is waiting. One index-backed read is added, only for opted-in low
urgency pages. `tests/load/notification-bundling-benchmark.ts` measures `createCentralNotificationIntent`
p99 OFF vs ON against a 50,000-row history and fails when ON exceeds OFF by more than 5 ms.

### Reading and deciding

`ops-insights/view.ts`:

- `listInsightsForScope(actor, scope, { limit, includeDecided })`: one scope, most severe first, at most 50.
- `countOpenInsightsForScopes(actor, type, ids)`: a list page's badges: one grouped query on the unique
  index plus one primary-key visibility query, at most 200 ids, absent when zero.
- `listInsightsInbox(actor, { limit, cursor })`: the cross-area inbox, keyset-paged on
  `idx_ops_insight_inbox`, with the scope's name and link.

Every reader returns nothing while the feature or the area is off, and filters through the product's own
read filters (`serviceReadWhere`, `scheduleReadWhere`, `runbookReadWhere`, `teamReadWhere`, the escalation
policy read rule). A `USER`-scoped insight is visible to that person, an owner of a team they belong to and
administrators, and to nobody else.

`decideInsight(actor, { id, decision })` records accept, dismiss or reopen. It needs
`intelligence.feedback`, shares the feedback rate limit, reports an insight the actor cannot see as "not
found", is a compare-and-set against the lane, and writes an audit entry
(`intelligence.ops_insight.accept|dismiss|reopen`) in the same transaction. Accepting changes only the
insight.

### Rollups

`src/lib/metric-rollup.ts` adds daily operations rollups in `MetricRollup`, run by the existing daily
rollup step of the cron scheduler (`generateOpsRollups`; a no-op while operations insights are off):

| Name                          | `subjectKey`          | `tags`                                                                                                                                                                                   | `count` / `sum`                                     | Driven by                                                         |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `ops.pages.user_hour`         | user id               | `hour` (0-23 in the user's time zone), `weekend`                                                                                                                                         | incident pages / distinct incidents                 | `idx_notification_created_cursor`                                 |
| `ops.runbook.outcome`         | runbook id            | `status`                                                                                                                                                                                 | finished executions / total run time (ms)           | `idx_runbook_execution_completed` (new)                           |
| `ops.runbook.run`             | runbook id            | `status`, `onIncident`, `fixMinutes` (finish to resolution, at most a day; read against the fix window so the window can change without a recompute), `durationBucket` (floor(4·log2 s)) | finished runs / 0                                   | `idx_runbook_execution_completed`                                 |
| `ops.runbook.step_outcome`    | runbook id            | `stepKey`, `name`, `status`, `retried`, `errorCode`                                                                                                                                      | step runs / 0                                       | `idx_runbook_execution_completed`, then steps by `executionId`    |
| `ops.automation.rule_match`   | automation version id | `serviceId`, `ruleId`, `ruleName`, `mode`                                                                                                                                                | decisions / fallbacks                               | `IncidentAutomationDecision (serviceId, createdAt)`               |
| `ops.pages.user_service`      | user id               | `serviceId`, `hour` (local, first page of the day), `autoResolved`                                                                                                                       | pages (one per person, incident and day) / acted on | `idx_notification_created_cursor`, then `Incident` by primary key |
| `ops.pages.service`           | service id            | `autoResolved`                                                                                                                                                                           | pages / acted on                                    | same statement, grouped by service                                |
| `ops.escalation.step_outcome` | policy id             | `step`, `outcome`, `reason`, `hour` (paged person's zone, UTC when nobody was paged), `ackWithinMin`                                                                                     | attempts / seconds to acknowledge                   | `idx_escalation_step_attempt_created` (new)                       |

Each rollup advances one complete UTC day per transaction from its own watermark row
(`<name>.watermark`), deleting and rewriting the day with the watermark so a crash or a second scheduler
cannot double-count. A first run starts 30 days back; at most 31 days are computed per run. Rows never set
`serviceId`, because incident enrichment reads `MetricRollup` by service. `queryOpsRollup` is the bounded
reader. The retention sweep (`purgeOpsInsights`) deletes `ops.pages.user_hour` and `ops.pages.user_service`
rows whose person no longer exists, in bounded batches; service-keyed rows stay. Query plans are asserted in `tests/integration/intelligence/ops-rollups.test.ts` and recorded by
the load gate `tests/load/intelligence-query-plans.ts`.

### Escalation step capture and policy insights (J2)

**Capture.** `EscalationStepAttempt` (primary key incident, escalation generation, step index) records
each step the escalation worker runs: policy and revision, target type and id, resolved user ids, outcome
(`NOTIFIED`, `SKIPPED` with a reason code, `FAILED`, `SCHEDULED` for a delayed step) and when it notified.
It is written inside the statement that `src/lib/escalation/repository.ts` already sends to append the
`IncidentEvent` (commit path and delayed-step path), as one more CTE: no extra read and no extra round trip.
`tests/integration/escalation-step-attempt-capture.test.ts` counts statements on the commit path.
`Incident.acknowledgedById` and `acknowledgedVia` (the lifecycle command source) are set in
`updateDataForCommand` in `src/lib/incidents/lifecycle.ts`, cleared on reopen and unacknowledge.

**Backfill.** `src/lib/escalation/step-attempt-backfill.ts` rebuilds 90 days of attempts from escalation
timeline text, marked `approximate`, in bounded keyset batches with a resumable cursor; live rows are never
overwritten. It runs on the intelligence lane, not as a script: while escalation insights are on, the
ops-insights scan queues one coalesced `BACKFILL_ESCALATION_ATTEMPTS` item, whose handler
(`runEscalationAttemptBackfill` in `ops-insights/handlers.ts`) does one 250-incident batch under
`withDbBudget`, saves the keyset cursor (`IntelligenceCursor` `escalation-attempt-backfill`) in the same
transaction, and re-queues itself until the window is walked; the cursor then records done and nothing is
queued again. Job payloads are not read: escalation jobs are retention-swept after 7 days.

**Rollup.** `ops.escalation.step_outcome` judges each attempt per UTC day: `ACKED` (the incident was
acknowledged in the same generation while this was the latest notified step), `TIMED_OUT` (a later step
was notified), `UNANSWERED`, `SKIPPED` or `FAILED` with the reason. `src/lib/escalation/step-outcomes.ts`
folds the rows into per-step summaries (`loadPolicyStepOutcomes`, one bounded subject read).

**Producer.** `escalation.policy` (scope `POLICY`, area `escalation`) in
`src/lib/intelligence/ops-insights/producers/escalation-policy.ts` reads the policy and its steps, a
service count, one grouped read each for team and schedule sizes, and the rollup. It derives: a step never
acknowledged (at least 5 pages, no acknowledgement in 30 days), step 1 timing out at night (at least 50% of
night pages timed out and 20 points above day), a step always skipped with its most common reason, a
shorter wait before the next step from the 75th percentile of acknowledgement times (bounded to 2-60
minutes, at least 10 acknowledgements, saving at least 3 minutes) with the expected effect, one person on
every step, and a policy no service uses (after 7 days). Evidence holds counts only.

**UI.** `loadPolicyIntelligence` (`src/lib/intelligence/ops-insights/policy-intelligence.ts`) returns nothing unless the
viewer may read escalation policies and the area is on; otherwise one `listInsightsForScope` read and one
rollup read. The policy page shows an Insights tab (`InsightsPanel`, only when an insight is open), one
line per step (`StepOutcomeStrip`) and `InsightBadge` on the policies list (`countOpenInsightsForScopes`).
"Apply suggestion" links to `?tab=steps&suggestStep=<id>&suggestDelay=<min>`; the page validates both and
the step editor opens with the wait filled in. Nothing is saved until the person saves.

### UI kit

`src/components/intelligence/insights/`: `InsightBadge` (count and highest severity for a list row) and
`InsightsPanel` (the list, and its `InsightRow`, with an evidence popover, accept and dismiss, an optional
"Create draft" link and "Ask Squire about this", which only hands a question to the assistant). The one
"Needs attention" section on `/intelligence` and `/m/intelligence` (`overview/NeedsAttention`, loaded by
`AttentionSection`) ranks the overview's decision probes and open insights together by severity, then age
(`rankAttention`). All render nothing when there is nothing to say. Only `InsightActions` is client code.

### Service automation (J1.1 to J1.3, J1.6)

Nothing here touches `processEvent` or `automation/runtime.ts`; every piece reads stored data in the lane,
a background job or on request.

**Replay** (`src/lib/automation/replay.ts`, `replay-run.ts`). `replayStoredEvents` runs a snapshot through
the same compiler and pure evaluator the live path uses, over the service's stored alerts for 7 to 30 days:
keyset pages of `REPLAY_BATCH_SIZE` (500) on `(serviceId, createdAt)`, at most `REPLAY_MAX_EVENTS` (20,000),
each page under a 10 s statement budget. It reports, against what actually happened: same, route changed,
priority changed, no-escalation changed, fallbacks, evaluations over the live deadline, default-routed,
unmapped fields, tags, per-rule matched and shadowed counts, route and priority transitions, evaluation time
p50/p99/max and up to a few example incident ids. Each replayed event also carries whether a person changed
the incident within `OVERRIDE_WINDOW_MINUTES` (15). `tests/lib/automation-property.test.ts` asserts that
replay equals live evaluation for generated snapshots and events.

`startAutomationReplay` validates the snapshot (a missing or archived policy is a validation error), stores
an `IntelligenceEvaluationRun` (`kind: REPLAY`, `metrics.type: AUTOMATION_REPLAY`, progress 0..1) and
queues one `SCHEDULED_TASK` job (`task: AUTOMATION_REPLAY`, one attempt). An identical request within 10
minutes returns the existing run; a run not finished within 10 minutes reads as failed. Surfaces:
`AutomationReplay` in `AutomationReviewDialog` (a "Replay against last 7 days" step before the
acknowledgement checkboxes) and in the Test tab, and REST `POST /api/v2/services/{id}/automation/replay`
(202, body `{ snapshot, days?, integrationType? }`) and `GET …/replay?runId=` (both `automation.read`).

**Rule health** (`producers/automation-rule-health.ts`, kind `automation.rule_health`, scope `SERVICE`,
area `automation`). `loadInput` makes three bounded reads: the `ops.automation.rule_match` rollup for the
active version over 30 days, one statement over the newest 2,000 settled LIVE decisions on
`IncidentAutomationDecision (serviceId, createdAt)` joined to `IncidentEvent` for corrections and
acknowledgements, and one replay page of 500 events from the last 7 days.

| Key                              | Fires when                                                                                                                                                                                               | Severity                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `shadowed:<ruleId>`              | In the sample (at least 50 events) a route rule's conditions held at least 5 times but an earlier rule always won.                                                                                       | `WARNING`                     |
| `never-matched:<ruleId>`         | A route rule has no match in the rollup (version published for at least 7 days, at least 50 decisions), or an enrichment rule has no match in the sample. A shadowed rule is reported once, as shadowed. | `INFO`                        |
| `unmapped:<field>`               | A context field is unmapped for 20% or more of the sample.                                                                                                                                               | `WARNING` at 50%, else `INFO` |
| `overridden:<ruleId or default>` | At least 10 decisions by the rule (or the service default), and a person changed priority, urgency or assignee within 15 minutes for 30% or more.                                                        | `WARNING`                     |
| `policy-no-ack:<policyId>`       | Automation routed at least 10 incidents to a policy and none was acknowledged.                                                                                                                           | `WARNING`                     |

Stored text names no rule, field or policy, only counts; the key carries the id and the automation
workspace (`AutomationInsights.tsx`, shown in `ConfigurationHealth` through `InsightsPanel`) resolves names
for people who may read automation.

**Suggested rules** (`learning/automation-mining.ts`, `producers/automation-suggested-rules.ts`, kind
`automation.suggested_rule`). One grouped statement over the newest 2,000 settled public incidents of the
last 30 days (`idx_incident_sla_by_service`, opening alert on `idx_alert_incident_cursor`) counts, per
(opening severity, source), how many incidents a person changed to each priority and how many a person
handed to a team (an `ASSIGNMENT` event "Incident assigned to team:" and the incident's final `teamId`),
capped at 1,000 groups (`AUTOMATION_MINING.maxGroups`, largest first). `mineAutomationRules` suggests
"severity/source → priority" or "severity/source → route through policy P" when at least 5 incidents
support it (of at least 8 with those facts) and the Wilson lower bound (`recommendations/wilson.ts`) is at
least 0.5; at most 5, skipping rules the active version or draft already has. A team hand-off becomes a
`USE_ESCALATION_POLICY` suggestion only when exactly one live policy pages that team at its first step and
it is not the service's own policy (two bounded `EscalationRule` reads, only when hand-offs exist);
automation has no team action, and this is the only policy change a person makes after creation, so it is
how policy corrections are mined. Only public incidents are mined, so evidence never carries a value some
viewer of the service could not read. The insight's `draftHref` is
`/services/{id}?tab=automation&suggestedRule=…` (`suggested-rule.ts`): the workspace shows the rule and
nothing joins the draft until a person adds it; publishing goes through the review and its replay step.

**Squire** (`squire/tools-automation.ts`). Read tools `get_automation_decision` (the stored decision trace
for an incident the person can read) and `explain_automation_rule` (one rule of a readable service, its
rollup matches and open rule-health insights), offered only with `automation.read` and, over MCP
`ask_squire`, only with the `automation:read` scope. `draft_automation_rule` is a `NAVIGATE` proposal
through the sealed-proposal flow, described only to people who may edit automation: confirming it opens the same pre-filled workspace link; it never saves or
publishes.

### Small helpers (J7)

Behind `IntelligenceSettings.opsHelpersEnabled` (default off, with the master switch). None writes on
read, none is on the ingestion, escalation or notification path, and none calls a model except the
expanded analytics line. Pure logic sits in `src/lib/intelligence/helpers/<name>.ts`, the scoped loader
beside it in `<name>-loader.ts`, the server action next to the page that uses it.

| Helper                      | Loader                     | Reads                                                                                                                                                                   | Bound                                                                                                                                        |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create-incident suggestions | `create-suggest-loader.ts` | `IncidentFingerprint` trigram candidates from the similarity retrieval (`retrieval.ts` exports), joined to incidents under `incidentReadWhere`                          | 25 candidates per source, 20 look-alikes scored, 400 ms database budget; client debounce 500 ms, title ≥ 8 characters, stale answers dropped |
| Status-update draft         | `status-draft-loader.ts`   | the page's shown components, `ServiceDependency` upstream closure, open incidents on those services under the viewer's scope                                            | 200 components, 2 dependency hops, 3 drafts                                                                                                  |
| Palette knowledge search    | `palette-search-loader.ts` | `searchKnowledgeForActor` (FTS + trigram, embedding re-rank only when configured, per-source visibility) over postmortems, runbook steps, resolution and incident notes | queries of 3+ words, 5 hits                                                                                                                  |
| "Why did this change"       | `metric-change-loader.ts`  | two grouped reads of `IncidentMetricRollup` (daily, per service) for the last N complete UTC days and the N before, limited to `serviceReadWhere`                       | one row per service; ≤ 90-day window                                                                                                         |

The metric decomposition is exact: per-service count deltas, or for a mean
`sum_i(current)/n(current) − sum_i(previous)/n(previous)`, which add up to the whole change; the line lists
the top three services that moved it in its direction. Expanding the line recomputes on the server and may
phrase it through `cachedGenerate` (callSite `interactive`, `AI_OUTPUT_TOKENS['analytics.metric-change']`),
so reopening with unchanged numbers costs nothing; the list page itself never calls a model. The weekly
digest adds the recipient's top five open insights from `listInsightsInbox` (scoped as on `/intelligence`).
