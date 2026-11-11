---
title: Run OpsKnight Intelligence in production
description: Deploy, enable, monitor, roll out and roll back the Intelligence engine with gated automatic grouping and the Squire assistant.
type: deployment
product_area: intelligence
audience: [operator, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Take Intelligence from disabled to suggest mode safely, watch it, and turn it off again.
verification:
  level: test
  verified_at: 2026-10-30
  evidence:
    [
      src/lib/intelligence,
      monitoring/prometheus/opsknight-alerts.yaml,
      tests/integration/intelligence,
      tests/e2e/intelligence-ui.spec.ts,
      tests/evals/squire,
      scripts/check-squire-eval-baseline.cjs,
    ]
---

# Run OpsKnight Intelligence in production

Intelligence suggests similar past incidents, related incidents, possible causes and runbooks, and runs
the Squire assistant. Certified service AUTO adds reversible related-incident children after paging.
Squire executes only actions a person explicitly confirms, through existing application permissions.
Neither changes paging, suppresses incidents nor bypasses runbook approvals. It is off after upgrade and stays off until an administrator enables it.

Everything in this guide except process placement is configured in **Settings → Intelligence**. There are
no feature environment variables.

## What it needs

| Need     | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database | The existing PostgreSQL. Migrations are additive. `pg_trgm` is optional; without it, matching uses full-text search, and Settings shows which tier is active.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Process  | The lane runs inside `integrated`, `worker` and `general-worker` processes. For larger installs, run it alone with `OPSKNIGHT_PROCESS_ROLE=intelligence-worker`. That role has no scheduler, job worker or runbook duties. Every split package (Compose, Helm, Swarm, Kustomize) deploys this role separately by default, setting `OPSKNIGHT_INTELLIGENCE_DEDICATED=true` on shared roles so only the dedicated role hosts the lane. Size its pool with `DATABASE_POOL_SIZE_INTELLIGENCE_WORKER` and reserve one additional direct PostgreSQL connection per lane replica for notifications. On a single-node `integrated` install, set `maxConcurrency` to 1 and `batchSize` to 10 in Settings → Intelligence so analysis never holds more than one connection beside paging. |
| Egress   | None, unless you enable AI. Each AI provider is reached only at the address an administrator saved. Vertex AI also fetches short-lived tokens from Google's fixed OAuth endpoint. Squire's read-only observability connections, when enabled, reach only their saved addresses ([guide](observability-connections.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Email    | Only for the optional weekly digest, sent through the email provider configured under Notifications.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Running several workers is safe. Work is claimed with `SKIP LOCKED` leases, so two replicas never process
the same item, and a crashed replica's work is picked up when its lease expires.

## Safety properties to rely on

- **Paging is never affected.** The lane only reads incidents after they exist; nothing is written when an
  incident is created. When escalation or notification work falls behind, the lane pauses itself and
  resumes when that work clears.
- **Bounded cost.** Every analysis runs with a statement and lock timeout from Settings, a per-item time
  budget and capped candidate counts.
- **No data leaks.** Every suggestion is filtered by the viewer's own access when shown, in the UI, the REST
  API and the assistant.
- **Readiness never fails because of it.** `/api/health?mode=readiness` reports `intelligence` as `healthy`,
  `degraded` or `disabled`, never `unhealthy`.

## Monitor it

The original lane gauges remain available:

| Metric                                                  | Meaning                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `opsknight_intelligence_queue_ready`                    | Work waiting to run                                        |
| `opsknight_intelligence_queue_oldest_ready_age_seconds` | Age of the oldest waiting item                             |
| `opsknight_intelligence_dead_letters`                   | Items that exhausted their retries                         |
| `opsknight_intelligence_lane_paused`                    | `1` while the lane is yielding to paging, per instance     |
| `opsknight_intelligence_lane_last_cycle_age_seconds`    | Seconds since the lane last finished a cycle, per instance |

Lane gauges exist only on instances running the lane, so a disabled install exports nothing that alerts.

`opsknight_intelligence_pool_waiting_queries` reports the last measured waiting-query count on a
lane process. Missing measurements are omitted. Pool pressure pauses work until two consecutive
quiet samples; the existing paging-lag recovery threshold still applies independently.

Human suggestion reviews are exported as `opsknight_intelligence_suggestions_reviewed_last_24h`
and `opsknight_intelligence_suggestion_acceptance_ratio_last_24h`. AUTO and undo transitions do
not count as accept/reject reviews. The ratio is omitted with no reviews. The sample is capped at
5,000 decisions, with `opsknight_intelligence_suggestions_sample_truncated` signalling incomplete
coverage. These are cluster snapshots; aggregate replicas with `max`, not `sum`.

### Common alert metadata and online backfill

New alerts include normalized severity, resource, labels and a content fingerprint. Existing rows
remain nullable during upgrade. Preview the backlog and apply a bounded online backfill:

```bash
npm run alerts:backfill
npm run alerts:backfill -- --apply --max-rows=100000
```

The command uses the configured database. It processes at most 250 alerts per transaction, pauses
for paging or pool contention, and guards each write against concurrent source edits. It preserves
payloads and creation timestamps. Rerunning retries skipped rows and continues the remaining
backlog. Raw SQL edits that do not update an alert's edit timestamp require an explicit Intelligence
refresh; the regular application uses versioned ORM edits.

Creation/edit cursors make normal indexing incremental. Source repair can still read all alert
payloads after a normalization change, count mismatch or explicit operator refresh. Observation
uses resumable source pages and retained service/time buckets; buckets expire after 30 days, even
when analysis is disabled. Engine `1.4.0` changes normalization bounds, so earlier AUTO
certifications must be reviewed and renewed before new automatic decisions are allowed.

`monitoring/prometheus/opsknight-alerts.yaml` includes the `opsknight.intelligence` group. Every rule is a
**warning**. Intelligence is advisory, so nothing here should wake anyone at night.

| Alert                                  | Fires when                                                | First response                                                                |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `OpsKnightIntelligenceLaneStalled`     | No completed cycle for 5 minutes, sustained 5 minutes     | Check worker logs and database health; restart the worker if wedged.          |
| `OpsKnightIntelligencePausedForPaging` | Paused for 15 minutes                                     | Investigate the paging backlog first. Intelligence resumes on its own.        |
| `OpsKnightIntelligenceBacklogStale`    | Oldest work waiting over 15 minutes, sustained 10 minutes | Raise batch size or concurrency in Settings, or add an `intelligence-worker`. |
| `OpsKnightIntelligenceDeadLetters`     | Any dead letter for 15 minutes                            | Review and replay them in Settings → Intelligence.                            |

Work items and AI calls also emit OpenTelemetry spans (`intelligence.work`, `intelligence.ai.generate`,
`intelligence.ai.stream`) when a tracer provider is registered. Spans carry categories and token counts,
never incident data, prompts or answers.

## Roll it out

Do each step on one environment before the next, and keep a step running long enough to see a normal week of
incidents.

1. **Shadow.** In Settings → Intelligence, turn on the master switch and publish the global policy in
   **Shadow** mode. Everything is computed and stored; nobody sees it. Watch the dashboards above and your
   ingestion and paging latency. Nothing should change.
2. **Suggest for one service.** In **Per-service policies**, give one well-understood service its own
   **Suggest** policy. Ask its responders to use the thumbs on suggestions.
3. **Review quality.** **Insights** shows how ratings fall by match score. If low scores are mostly
   unhelpful it proposes a higher threshold, which you apply with one click as a new policy version.
4. **Suggest globally.** Publish the global policy in **Suggest** mode. Keep noisy services on Shadow with
   their own policies.
5. **Assistant without AI.** In **Assistant & AI**, turn on the assistant and leave AI off. It answers from
   your incident data only.
6. **Assistant with AI.** Add a provider and use **Test connection**. Start with a self-hosted model or a
   provider your data-processing agreement covers. AI conversations require a data ceiling of **Personal**
   because questions, browser history and saved history may identify people. Approve that data boundary
   explicitly and set a daily token budget; with only **Internal** providers the assistant explains the
   restriction and uses basic mode without sending conversation text to a model. Leave **Allow fallback from self-hosted to external providers** off unless you have decided
   otherwise. If data must stay in a region, tag each provider with its region and set **Allowed data
   regions**; untagged providers are then never used.
7. **Summaries and drafts.** Incident summaries and postmortem drafts send timelines and responder notes,
   so they only run on a provider whose ceiling is **Personal**. Leave every provider at **Internal** to keep
   them unavailable.
8. **Optional extras.** Each is off until you turn it on:
   - **Semantic search**: give a provider an embedding model, explicitly permit Personal data, and turn on semantic search. Masked titles can still contain names; an Internal-only provider is not eligible. The AI page shows
     indexing progress. Watch the token budget for the first day while recent incidents are indexed.
     Vectors are specific to the provider, endpoint, deployment options and embedding model. Changing
     any of those starts a bounded rebuild of recent incidents within the existing opt-in token budget;
     older incompatible vectors are excluded and age out normally. Upgrading from the legacy model-only
     cache key also requires that rebuild. Display-name, priority and credential rotation alone do not
     invalidate vectors. Temporary provider outages do not switch the embedding deployment or rebuild
     vectors with a backup model; new embeddings wait for recovery and existing compatible vectors
     remain usable. Chat fallback settings still apply to chat. Use pinned model revisions where available: an upstream model changing behind
     an unchanged alias cannot be detected automatically.
   - **Saved conversations**: choose a retention period first. Turning this specific setting off later
     deletes saved conversations in batches. Turning AI off keeps history readable and basic-mode chats saved; hiding the assistant removes its launcher while
     keeping unexpired history; normal retention still runs.
   - **Weekly digest**: in **Insights**, pick a day and hour, then use **Send me a test**.
   - **Suggested grouping rules**: in **Insights**, once responders have confirmed links, use **Find rule
     suggestions** and add any that look right. Each one becomes a new policy version that you can roll
     back.

## Deterministic AIOps features (no AI provider needed)

Everything in this section is computed in the intelligence lane from OpsKnight's own data, is off until an
operator turns it on, and only ever suggests. Each one degrades to "nothing shown" on any failure.

| Feature                 | Turn on                                                                             | What you get                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Triage suggestions      | Policy → **Suggest triage** (global or per service); needs similarity on            | Chips on the incident under Similar: suggested urgency, owner (team or person), probable duplicate, expected time to resolve. Accept runs the normal incident command; dismiss records feedback. A service burning its error budget never gets a suggestion to lower urgency.                                                                                                                                        |
| Change risk             | On whenever changes are recorded                                                    | A 0–100 risk on each change (history of incidents after the source's changes, blast radius from the dependency graph, off-hours timing, size labels), shown on possible causes and in Settings → Response.                                                                                                                                                                                                           |
| Native change sources   | Create a generic webhook integration per service and point the tool at the endpoint | `POST /api/integrations/{argocd,launchdarkly,unleash,terraform}?integrationId=…` map the tool's own webhook payload to a change. Argo CD: finished syncs; LaunchDarkly/Unleash: flag changes; Terraform: applied and errored runs.                                                                                                                                                                                   |
| Topology import         | Settings → Intelligence → Response → **Import topology from Backstage**             | Paste a catalog or add an https catalog URL pulled on a schedule (SSRF-guarded, 2 MB bound). Entities match services by the `opsknight.com/service-id` annotation or exact name; `spec.dependsOn` becomes declared dependencies. `GET /api/intelligence/topology/graph` serves the graph with an open-incident overlay.                                                                                              |
| SLO burn                | Define an availability or uptime objective for the service                          | `getSloBurn` reports 1 h / 6 h burn rates; triage and (later) grouping prefer burning services. Suggest-only.                                                                                                                                                                                                                                                                                                        |
| Cause-ranking weights   | Settings → Intelligence → Insights → **Cause-ranking weights**                      | Fitted from feedback on possible causes; published only by a person, as a policy version you can roll back.                                                                                                                                                                                                                                                                                                          |
| Runbook-ranking weights | Settings → Intelligence → Insights → **Runbook-ranking weights**                    | Fitted from accept/reject feedback on runbook recommendations and from what happened when a recommended runbook was run (fixed: succeeded and the incident resolved within 2 hours; not fixed: failed, timed out, or no resolution in that window). Needs 40 labelled recommendations with at least 8 of each outcome and a held-out improvement; published only by a person, as a policy version you can roll back. |
| Incident time axis      | On for anyone who can see suggestions                                               | **Timeline** tab on the incident: alerts, changes (with risk), upstream incidents and noise decisions relative to onset.                                                                                                                                                                                                                                                                                             |
| Incident impact         | On for anyone who can see suggestions                                               | **Impact** tab on the incident: dependent services from the active graph (walked only through services the viewer can read), linked status-page components with their status, and SLO error budget at risk (global metrics access only).                                                                                                                                                                             |
| Alert-quality actions   | Settings → Intelligence → Response                                                  | Noisy services rolled up by team, with a flapping ratio and one-click Jira issue (service mapping or default project), plus links to routing/severity and integrations.                                                                                                                                                                                                                                              |
| Shift handoff summary   | Settings → Intelligence → **Send shift handoff summaries**                          | At each rotation the incoming responders get open and recently resolved incidents and overdue follow-ups for the schedule's services, by email and in-app; an AI narrative is added only when AI is enabled.                                                                                                                                                                                                         |

## Performance gates

Three benchmarks run nightly and under the `ci:full` label (`.github/workflows/intelligence-performance.yml`)
and fail the run when the contract is breached, so a change that slows ingestion or the lane cannot ship
unnoticed:

| Gate                              | Contract                                                                                                          | Script                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Ingestion A/B (lane busy vs idle) | `processEvent` p99 at most +10 ms and p50 at most +2 ms, median paired difference; lane busy; no failures         | `tests/load/intelligence-ingestion-ab.ts` |
| Storm drain                       | 10,000 new incidents over 1,000,000 history drained in under 10 minutes; no dead letters; per-kind p99 under 10 s | `tests/load/intelligence-storm.ts`        |
| Query plans                       | Every hot query, including the production claim statement, uses its index                                         | `tests/load/intelligence-query-plans.ts`  |

Each script takes `--output` and `--no-gate` (record only). Measured results are committed under
`plans/intelligence-engine/certification/perf/`.

## Assistant evaluation

Every pull request runs the assistant's structural evaluation with no AI provider: basic-mode answers on a
seeded database, and AI mode against a scripted local model that checks tool scoping, redaction of secrets
and injected instructions, which actions become confirmation cards, citations, data-class refusals and the
token, step and output ceilings. It covers every tool and action the assistant offers, including the
observability connectors (metrics, logs, traces, error events, code diffs, each answered by a local stand-in
that returns hostile text) and the opt-in extended actions; a tool or action added without an evaluation
case fails the suite.

The nightly **Squire live-model evaluation** workflow (`.github/workflows/squire-evals.yml`) also asks a real
model, then grades each answer with a second model against a rubric for its category. It runs only when the
repository has these settings; without `SQUIRE_EVAL_API_KEY` it records a skipped run:

| Setting                      | Kind     | Purpose                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------- |
| `SQUIRE_EVAL_API_KEY`        | secret   | Key for the evaluated OpenAI-compatible model; turns the run on.     |
| `SQUIRE_EVAL_MODEL`          | variable | Evaluated model (default `gpt-4.1-mini`).                            |
| `SQUIRE_EVAL_JUDGE_API_KEY`  | secret   | Optional separate key for the judge; defaults to the evaluation key. |
| `SQUIRE_EVAL_JUDGE_MODEL`    | variable | Optional judge model; defaults to the evaluated model.               |
| `SQUIRE_EVAL_JUDGE_BASE_URL` | variable | Optional judge endpoint; defaults to the evaluated endpoint.         |

The run uses synthetic data in a disposable database. It fails when the structural pass rate, a must-pass
safety case, the per-case token ceiling or the judge's scores fall below `tests/evals/squire/baseline.json`;
the report is uploaded as the `squire-eval-report` artifact. Set `SQUIRE_EVAL_JUDGE=off` to run without
the judge. Raise the baseline only by committing a reviewed value.

## Robustness and self-protection

The lane is built to fail small and heal on its own. What you will see, and what to do:

| Situation                                         | What the lane does                                                                                                                                                                                                                                      | What you do                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A work item fails 8 times                         | It becomes a dead letter. Signalled again after 30 minutes, it gets one more round (an outage is over).                                                                                                                                                 | Nothing, unless `OpsKnightIntelligenceDeadLetters` fires; then review the failure code.          |
| The same item dies twice within a day             | It is **quarantined**: never retried on its own, never purged, listed under **Failed work** with a Quarantined badge. Metric `opsknight_intelligence_work_quarantined`.                                                                                 | Fix the cause (the failure code says what kind), then **Replay**.                                |
| Most items of one kind fail within five minutes   | That kind alone is paused for five minutes (`opsknight_intelligence_kind_paused{kind}`); every other kind keeps running. The pause is per process and lifts itself.                                                                                     | Check the worker logs for that kind if `OpsKnightIntelligenceKindPaused` stays on.               |
| A handler exceeds its time budget                 | Its running statement is cancelled and, a second later, its backend terminated if it has not let go. Until it does, it keeps its concurrency slot (`opsknight_intelligence_timed_out_in_flight`); the lane claims no new work while every slot is held. | Raise `maxJobMs` only if the work is legitimately that slow; otherwise look at the failing kind. |
| A wake notification is lost                       | Every cycle walks incidents by `updatedAt` from a watermark, so a lost acknowledgement, resolution or alert is re-indexed within a cycle or two, whatever the size of the history. A slow 10-minute sweep covers engine upgrades and placeholders.      | Nothing.                                                                                         |
| An incident has tens of thousands of alerts       | Its alert bootstrap runs in passes of at most 5,000 payloads; each pass saves its progress and re-signals itself. Analysis waits until the last pass.                                                                                                   | Nothing. The incident shows **Waiting** until the bootstrap completes.                           |
| Retention hits a huge or contended table          | Each table is its own short transaction; the alert rows of expired incidents are drained in bounded bites before their parents go. A failing table never blocks the others, and batches shrink until sweeps are clean.                                  | Nothing. `opsknight_intelligence_retention_rows_deleted_total{table}` shows progress per table.  |
| Several lane replicas run                         | One replica holds the wake-leader lock and turns notifications into work (`opsknight_intelligence_wake_leader`); the others poll. Discovery, both sweeps, retention and the dependency observer are single-holder too.                                  | Nothing.                                                                                         |
| The lane process dies or hangs on its first cycle | `opsknight_intelligence_lane_up` disappears with the process; `OpsKnightIntelligenceLaneGone` fires when a lane reported within the hour and none does now. The cycle age counts from start, so a lane wedged before its first cycle also shows.        | Restart the worker.                                                                              |
| A `CREATE INDEX CONCURRENTLY` was interrupted     | The container start runs `npm run prisma:indexes:repair-invalid`, which rebuilds invalid indexes online and drops rebuild leftovers. It warns and continues if it cannot.                                                                               | Re-run `npm run prisma:indexes:repair-invalid` when the database is quiet.                       |

Discovery bounds, the repair sweeps and the queue use the database clock, so application clock skew cannot
make them skip or repeat work.

## Turn it off

Each control takes effect within seconds, needs no restart, and leaves paging exactly as it was.

| To stop             | Do                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Everything          | Turn off the master switch in Settings → Intelligence. Stored data is kept until retention removes it.                                 |
| One service         | Give it its own policy in **Off** mode, or return it to the global policy.                                                             |
| A bad policy change | Restore an earlier version from the policy history. This publishes a new version; history is never rewritten.                          |
| AI only             | Turn off **Enable AI**. The assistant keeps answering in basic mode.                                                                   |
| The assistant       | Turn off **Show the assistant**. Its code is then not sent to browsers at all.                                                         |
| Semantic search     | Turn off **Semantic search**. Matching immediately reverts to wording only; stored vectors age out with fingerprint retention.         |
| Saved conversations | Turn off **Let people save assistant conversations**. All saved conversations are deleted by the next sweep (within about 15 minutes). |
| The weekly digest   | Turn it off in **Insights**. A digest already queued for this week is dropped.                                                         |
| A learned rule      | Restore the policy version from before it was added.                                                                                   |

To remove the dedicated worker, stop the `intelligence-worker` process; the general worker roles take
the lane back.

## Data and retention

Retention for fingerprints, correlation, findings, change events and feedback is set in Settings and
enforced by a bounded background sweep, which keeps running even while Intelligence is off. Embedding vectors
follow fingerprint retention, and digest delivery records follow finding retention. Assistant conversations
are not stored unless saved conversations are turned on; then they are encrypted, visible only to their
owner, and removed after the retention period, when the setting is turned off, or when the person is
deleted. Audit entries for AI use record who, which capability, which provider and model, the prompt
version and token counts, never prompts or answers. See the privacy registry entries `intelligence` and
`ai-assistant`.

## Not in this release

Automatic grouping, any delay or suppression of paging, and assistant write actions are not implemented.
They need separate certification before they can exist. The open certification gates are listed in
`plans/intelligence-engine/certification/README.md`. Learned rules are only ever suggested; a person adds them.

## Measure quality before service AUTO

Start in **Shadow** or **Suggest** and collect explicit human reviews, including negative and critical
examples. Open **Settings → Intelligence → Quality**, choose a service and measure shadow quality.
The page reports precision, recall, false merges, critical false merges and calibration. Unreviewed
pairs are excluded; a small or incomplete labelled set fails closed.

A certification needs 200 reviewed predictions, 20 negatives, 20 critical labels, ≥98% precision,
≥95% Wilson lower bound, ≤1% false merges, ≥50% recall and zero critical false merges. Every enabled
rule needs passing evidence; topology also needs cross-service examples. **Certify** records the result,
then explicitly publish **Automatic** in that service's policy. Global AUTO cannot be enabled.

Certification expires in seven days and closes immediately for changed definitions, engine versions,
dependency graphs or later human reviews. Re-measure and certify before enabling it again. A closed
gate falls back to shadow; it does not modify paging. Responders can **Ungroup** an automatic child,
which records a human decision and vetoes automatic replay. Existing accepted links remain undoable
when the master switch is OFF. Keep the deployment certification ledger and operational drills separate
from this per-service runtime gate; synthetic test fixtures do not certify a production service.

AI requests reserve estimated tokens atomically against global and personal UTC-day budgets before
calling a provider. Usage settles per attempt, including failed/aborted requests and connection tests.
Expired reservations and confirmed-action receipts are purged in bounded sweeps, including while OFF.

Background incident embedding has its own allocation within the same global budget. In **Assistant & AI**,
set **Background embedding allocation (%)** from 0 to 80 (default 20). Zero pauses new backfills;
interactive semantic queries still use the person's normal allowance and existing vectors stay usable.
The usage panel shows the charged background tokens and its daily allowance. Both settled usage and
unexpired in-flight reservations count toward admission, across replicas. Reaching the allocation
completes the current background pass without quarantining it; scheduled discovery retries when
allowance is available, including after the next UTC midnight. Increasing the allocation also resumes
work without rebuilding compatible vectors. Estimates are pre-call guards, not a provider billing
hard cap: actual reported usage is always charged and can exceed an estimate.

Apply the new migration before starting the updated application. Earlier aggregate usage cannot be
classified by task; on the migration day it is conservatively charged to the background allocation
as well as the unchanged total. This can pause a backfill until midnight, but grants no extra spend
and does not change personal accounting. Older settings clients preserve an already saved allocation.
Complete the rollout to every web/worker replica before relying on the background sub-limit: an older
application process still enforces only the previous global/personal limits. A rolling-deployment
certification has not been claimed by these local fixtures.

### Feature telemetry and operator alerts

The authenticated Prometheus endpoint exports aggregate, label-free feature gauges. These are
cluster snapshots: aggregate replicas with `max`, and do not treat rolling-window counts as lifetime
counters. No incident/user/provider identifiers, recipient addresses, action inputs or error payloads
are exported.

- `opsknight_intelligence_embedding_enabled`, `opsknight_intelligence_embedding_pending` and
  `opsknight_intelligence_embedding_budget_remaining_tokens` show eligible indexing, recent backlog
  and allowance after settled usage plus live holds. Pending is capped at 1,000 (a lower bound at
  the cap). Scraping does not count the entire vector index or call a provider. The backlog warning
  requires available allowance and eligible indexing continuously for 30 minutes; disabled indexing,
  a zero/exhausted allocation and brief backlogs are excluded.
- `opsknight_intelligence_digest_failed_recipients_last_7d` and
  `opsknight_intelligence_digest_oldest_sending_age_seconds` cover at most eight runs started in the
  last seven days. Failed sends sustained for 15 minutes and a sending run older than one hour have
  separate warnings. Provider acceptance does not prove end-to-end mail delivery. Inspect digest
  history and delivery health before reviewed recipient retry; do not resend successful recipients.
- `opsknight_intelligence_squire_actions_confirmed_last_24h`,
  `opsknight_intelligence_squire_actions_succeeded_last_24h`,
  `opsknight_intelligence_squire_actions_failed_last_24h` and
  `opsknight_intelligence_squire_actions_uncertain_last_24h` describe the most recent 5,000 confirmed-action receipts
  within 24 hours. Uncertain includes `UNKNOWN` and `RESERVED`/`RUNNING` older than five minutes.
  A five-minute sustained warning requires the confirming responder to inspect their owner-only
  receipt and incident audit. An ordinary rejected action is counted but does not trigger this warning.
  Never automatically retry an uncertain write.
- `opsknight_intelligence_digest_sample_truncated` and
  `opsknight_intelligence_squire_actions_sample_truncated` explicitly flag omitted coverage. A
  sustained truncation warning means outcome counts are sampled. Measure database cost before
  changing caps; old retained history is not silently added to these time windows.
- `opsknight_intelligence_feature_probe_failed` reports an unavailable embedding, digest or action
  probe. Failed probes omit their samples and preserve other feature groups; they do not report a
  misleading zero. Aggregate statements have a 750 ms database budget. A 15-minute warning directs
  operators to database connectivity/timeouts. Probes log fixed category names without exception text
  and never fail application readiness.

Rules live in `monitoring/prometheus/opsknight-alerts.yaml`; test positive, transient, disabled and
budget-exhausted scenarios with `monitoring/prometheus/intelligence.test.yml`. Route these advisory
warnings to the operators of Intelligence rather than responder paging. Tune sustained thresholds
from measured deployment behavior; the local fixtures do not certify production alert effectiveness.

### Finding services and reviewing failed work

On **Grouping quality**, search for a service by name, use **More services** to browse additional
matches, then choose **View quality**. Search is case-insensitive and treats `%` and `_` literally.
The selected service stays available while you browse. If a service is removed or access changes,
restart the search; hidden services are never used as pagination anchors.

The Intelligence overview lists failed work with fixed diagnostic summaries for processing budgets,
database contention, AI usage limits, provider availability, invalid input and cancellation. Unknown
or legacy failures show a generic summary; raw exception bodies are withheld. New failures store only
a diagnostic code. Older queue text follows the existing retention sweep. Operators retain the native
**Retry** action; these summaries do not automatically replay work or change service policy.

Rule suggestions use a bounded sample: up to 2,000 reviewed pairs, 16 candidate patterns, and 5,000
recent incidents per replay. Stronger cheap evidence nominations reach the shortlist first, with
stable ties. Other patterns may be omitted. Every proposed rule still passes the existing precision,
support and replay-breadth checks and requires explicit audited publication.

### First insight and polling recovery

After an event transaction commits its incident and paging outbox, ingestion schedules a batched PostgreSQL notification without awaiting it. A lane session listens on `intelligence_new_incident`, signals durable indexing work and wakes the worker. Notifications are hints: bounded buffers may drop them, disconnects reconnect, and the discovery cursor continues polling with its safety lag. Behind a transaction pooler, configure `DIRECT_DATABASE_URL` for the session listener.

Indexing hashes incident analysis inputs and every alert in bounded cursor pages. An unrelated source timestamp change skips follow-up analysis and carries forward only matching completed freshness records. Operator refresh persists a force flag, including when routine signals coalesce into the same queue item. Alert fingerprints contain normalized text and safe labels, inherit the fingerprint retention period, and are written only by the lane.

The metrics registry exports `opsknight_intelligence_work_duration_seconds`, `opsknight_intelligence_work_failures_total` and `opsknight_intelligence_time_to_first_insight_seconds`. Filter first-insight observations by `origin="live"` for incidents first analyzed within an hour; older observations use `origin="backfill"`. A single local latency test is functional evidence, not a production throughput certification.

### Saved chats and basic-mode answers

New installations enable private saved chats with a default retention of **90 days after the last message**. Existing administrator opt-outs and custom retention settings are preserved. Configure this under Intelligence → Assistant & AI. AI providers are not required for saving or reading chats.

Open **Saved conversations** in the assistant to read earlier chats. **Load older chats** fetches another page; creating more than 50 chats does not delete earlier unexpired ones. You can read a saved incident chat from another page, then follow **Return to original context** to continue it. Reading a chat does not extend retention. Expired chats disappear from reads immediately; the background sweep removes their encrypted records. Individual threads remain bounded to 100 messages; a full thread continues in a new saved conversation while the earlier thread stays available until its own expiry. Titles and message contents remain encrypted and owner-scoped. Source access is checked again when reopening history, so revoked sources do not become readable through a saved answer.

Without AI, the assistant can search accessible incidents by service/title and relative time, prioritize active incidents by urgency, show a factual event timeline, and combine similar incidents, recorded resolutions, change leads and runbook recommendations into a briefing. Suggested investigation checks are fixed templates, not confirmed diagnoses or executed commands. Follow-ups reuse earlier questions for intent and fetch fresh facts; old assistant text is never treated as evidence. Free-form reasoning still requires an AI provider.

The signature Squire mascot uses the supplied pearl-white helm, crimson plume and cape, and slate visor as a lightweight SVG. The full character appears in the chat welcome state and the head appears in the launcher and header. Expressions follow typing, lookup, streaming, request failures and confirmed action outcomes. When AI is disabled, unavailable, or over quota, the resting mascot sleeps with an explicit Basic mode label; it wakes to think and respond using live data. Network loss preserves the draft and disables sending. Amber attention comes from the existing authorized realtime feed or the incident facts returned with an answer. All nine visual states are available in `OpsKnightSquire`; existing alternative avatars remain selectable. Optional motion respects both the application setting and reduced-motion preferences.

The assistant opens with **⌘/Ctrl+J**, expands to a wider desktop panel, and fills the screen on phones. Answers support markdown headings, lists, tables and copyable code. HTML stays inert; only exact server-cited destinations become answer links and remote images are not fetched. Completed messages are memoized so streaming updates affect the current response. Scrolling up pauses automatic following; **Jump to latest** returns to the new content. A separate live region announces completion without reading every streamed chunk.

**Edit question** and **Regenerate** create a new saved version instead of overwriting the original conversation or silently repeating a write action. New proposals still require confirmation. Saved-chat search filters the loaded pages; **Load older chats** continues pagination. Copy failures and retryable request errors remain visible. The composer grows with the draft, preserves IME input, and uses 44 px send and stop controls.

Basic mode also provides permission-scoped incident and alert reports, personal and team work queues, service ownership and recorded topology, runbook catalog search, recent change history, postmortems and follow-up tasks. Service, schedule and postmortem citations retain their canonical internal routes and are rechecked when saved chats reopen. See [Basic-mode questions and reporting limits](../../guides/intelligence/basic-mode.md).

### Extended assistant actions

**Extended assistant actions** (Intelligence → Assistant & AI) is off by default. When on, Squire can also propose escalating, changing urgency, snoozing (up to 24 hours), removing a related link, adding a watcher, creating a Jira issue, drafting and then separately publishing a status update, and running a runbook bound to the incident's service. Every card is confirmed by a person, runs with that person's permissions through the same commands as the UI, is refused for API keys, re-checks the facts it showed before acting, and writes the usual `intelligence.squire.action` audit entry with a single-use receipt. Escalations, Jira issues and status-page changes reach people or another system, so a dropped response is reported as unknown and never retried automatically. Runbook approval steps and the status page's own permissions still apply. The setting change is revision-locked and audited like the other AI settings; turning it off withdraws open cards. See [Confirm actions the assistant suggests](../../guides/intelligence/assistant-actions.md).

### Squire outside the web app

Three switches under Intelligence → Assistant & AI, all off by default, add Squire to Slack and Microsoft Teams (`@squire`, `/incident ask`), to MCP clients (the read-only `ask_squire` tool) and to the mobile incident pages. Each needs the assistant itself to be on. Chat mentions are queued through the durable ChatOps intent pipeline, so the background worker must run; the Slack app needs the `app_mentions:read` event subscription. Chat answers use the asker's linked OpsKnight account, and a suggestion's **Confirm** button works only for that person and only through the sealed proposal executor. See [Ask Squire in Slack, Microsoft Teams, MCP and on mobile](../../guides/intelligence/squire-everywhere.md).
