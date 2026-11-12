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
Dependencies, changes and alert quality. Only ACTIVE edges influence analysis. An hourly, bounded
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

Everything is configured in Settings → Intelligence → Assistant and AI; there are no environment
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

**Observability connectors (opt-in).** Settings → Intelligence → Connections stores read-only
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
passages from postmortems, resolution notes (the resolve message), incident notes (20+ characters), the
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
finding retention) and rendered on the incident page by `IncidentSquireProactiveCard`. Rendering re-checks
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

Settings → Intelligence → Per-service policies shows, for each service, the mode that applies and
whether it comes from the service's own policy or the global one. An administrator can create an override
(it starts from what currently applies), publish new versions of it, or return the service to the global
policy. Turning an override off sets `IntelligencePolicy.overrideActive = false`; it never deletes history,
and publishing or rolling back re-activates it. The list is built in a fixed number of queries for a
bounded page of services, filtered by the viewer's own service visibility.

## Insights and adaptive suggestions

Settings → Intelligence → Insights is computed on demand from bounded queries, so there is no background
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
measurement. A single-node `integrated` install keeps the lane in-process; there, Settings →
Intelligence should run with `maxConcurrency` 1 and `batchSize` 10 so analysis never competes with
paging for more than one connection at a time.

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
   failing lookup never touches the event transaction. A transaction-pooled (`pgbouncer=true`) or
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
any run. Keep ON to services where the noise justifies it until the lane's in-process cost is reduced
and the burst gate passes.

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
  recommended (fixed = succeeded and resolved within 120 minutes; not fixed = failed, timed out, or that
  window elapsed unresolved; runs on already-resolved incidents and still-open windows are undecided). Each
  label carries the evidence the ranker stored, so no history is re-derived. The reads start from recent
  feedback and from recently finished executions via `(status, updatedAt)`, are capped at 2,000 rows each
  and run under a 5 s statement timeout. A proposal needs 40 labels, 8 of each verdict and a held-out
  log-loss improvement of 0.01; it is recomputed server-side on publish and stored as
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

Settings → Intelligence → Quality measures explicit human-reviewed pairs over 30 days, capped at 2,000.
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

| Table | Purpose |
| --- | --- |
| `OpsInsight` | One insight. Unique on `(scopeType, scopeId, kind, key)`, so recomputation updates a row. Holds `area`, `severity` (`INFO` < `WARNING` < `CRITICAL`), `title`, `summary`, `evidence` (JSON, at most 4 KB: up to 12 facts, 5 examples, a window), optional `draftHref` (in-app path), `inputHash`, `status` (`OPEN`, `ACCEPTED`, `DISMISSED`, `RESOLVED`), `generation`, first/last seen, who decided. |
| `OpsInsightScopeState` | Per scope: the hash of the producers' inputs and when the scope was last computed. |
| `MetricRollup` (existing) | Daily operations rollups, with the new nullable `subjectKey` column and `idx_metric_rollup_subject (name, subjectKey, bucket)`. |

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

| Key | Fires when | Severity |
| --- | --- | --- |
| `silent` | The service sent at least 7 alerts in the week before its last one, and has now been quiet for a day or three of its usual gaps, whichever is longer. Stops after 30 days (probably retired). | `WARNING` |
| `volume-step` | The last 24 hours hold at least 50 alerts and three times the daily average of the 7 days before (needs 35 alerts in that week), or a quarter of it or less (needs 140). Not judged when a count hit its 20,000 cap. | `WARNING` up, `INFO` down |
| `missing-severity` | Half or more of the last 200 alerts (at least 20) have no severity. | `WARNING` at 90%, else `INFO` |

`loadInput` is two statements, every arm on `idx_alert_by_service (serviceId, createdAt)` with a `LIMIT`, so
a service with millions of alerts costs the same as a small one. It returns
`{ silentDays, silentHours, weekBeforeLastAlert, last24h, priorWeek, capped, recentSampled,
recentMissingSeverity }`; `silentHours` is exact for the first three days and whole days afterwards.
`derive` turns that into the items above, each with its facts and a `draftHref` to the service's
integrations page. Tests: `tests/lib/intelligence/ops-insights.test.ts` (pure half) and
`tests/integration/intelligence/ops-insights.test.ts` (fixtures with known answers).

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

| Name | `subjectKey` | `tags` | `count` / `sum` | Driven by |
| --- | --- | --- | --- | --- |
| `ops.pages.user_hour` | user id | `hour` (0-23 in the user's time zone), `weekend` | incident pages / distinct incidents | `idx_notification_created_cursor` |
| `ops.runbook.outcome` | runbook id | `status` | finished executions / total run time (ms) | `idx_runbook_execution_completed` (new) |
| `ops.automation.rule_match` | automation version id | `serviceId`, `ruleId`, `ruleName`, `mode` | decisions / fallbacks | `IncidentAutomationDecision (serviceId, createdAt)` |
| `ops.escalation.step_outcome` | policy id | `step`, `outcome` | attempts / seconds to acknowledge | Named and shaped only; its source arrives with the escalation capture slice. |

Each rollup advances one complete UTC day per transaction from its own watermark row
(`<name>.watermark`), deleting and rewriting the day with the watermark so a crash or a second scheduler
cannot double-count. A first run starts 30 days back; at most 31 days are computed per run. Rows never set
`serviceId`, because incident enrichment reads `MetricRollup` by service. `queryOpsRollup` is the bounded
reader. Query plans are asserted in `tests/integration/intelligence/ops-rollups.test.ts` and recorded by
the load gate `tests/load/intelligence-query-plans.ts`.

### UI kit

`src/components/intelligence/insights/`: `InsightBadge` (count and highest severity for a list row),
`InsightStrip` (one line for a tab header), `InsightsPanel` (the list, with an evidence popover, accept and
dismiss, an optional "Create draft" link and "Ask Squire about this", which only hands a question to the
assistant) and `InsightsInboxSection` (the "Needs attention" section on `/intelligence`). All render
nothing when there is nothing to say. Only `InsightActions` is client code.
