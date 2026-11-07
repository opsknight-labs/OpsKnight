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

**Basic mode pipeline.** Without a model, a turn runs `planBasicTurn` (`squire/deterministic.ts`):
normalise (contractions, `24h`/`7d` shorthand) → correct spelling against a closed domain vocabulary
(edit distance ≤ 2, first letter fixed, protected ordinary words, names never touched) → classify (the
first-match rules in `intents.ts` decide; when they abstain, weighted keyword features score each
intent and an ambiguous score becomes a two-choice clarification) → extract slots (limit, group-by,
team, person, incident reference, action verb) → resolve names with `pg_trgm` similarity limited to
what the person may read (`basic/entities.ts`, cached 60 s per actor scope) → read (`basic/reads.ts`,
paged, grouped, bounded) → propose → choose answer-aware chips. Dialogue state (pending clarification,
page cursor) is stored on `SquireConversation.state` when history is on and otherwise in memory for ten
minutes per person; it never holds message text. Identical questions are served from a 10-second
per-actor cache with their evidence. A `pageContext` (service, team, schedule, runbook, alert) from the
launcher is read under the person's own visibility or ignored. All patterns are bounded literals over a
message capped at 2,000 characters; a unit test times adversarial input. A 300-utterance paraphrase
corpus (`tests/unit/intelligence-squire-nlu.test.ts`) must classify at ≥95% and slots at ≥90%.

**Basic-mode proposals.** An explicit action ("acknowledge this", `/resolve …`, "assign to Alice") on an
incident page becomes a request that `chat.ts` passes to the same `buildProposal` the model's proposal
tools use, so the card is sealed, user-bound and expiring, and execution goes through the existing
confirm route and domain commands. Basic mode never writes; the architecture test's single-writer
invariant still holds.

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

**Evaluation and feedback.** Structural cases (`tests/evals/squire/basic-cases.ts`, about 45, with
follow-ups) run against a seeded database with no model on every pull request; the live-model cases run
nightly in `squire-evals.yml` when `SQUIRE_EVAL_API_KEY` is set, and `scripts/check-squire-eval-baseline.cjs`
fails the run below the stored baseline or when a must-pass safety case fails. Thumbs up/down with a
reason are stored in `SquireFeedback` (mode, intent, reason and a question digest only) and summarised on
the Quality page.

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

Split Compose and Helm default to the dedicated role. Its wake listener uses one additional
session connection, accounted for separately from the Prisma pool. Pool contention is measured
through Prisma's local engine metrics without acquiring another SQL connection; contention pauses
the lane and requires two measured quiet samples before recovery. Paging-lag hysteresis remains
independent. Missing pool telemetry is unknown, not a zero measurement.

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
Pre-paging orchestration/suppression, parent/child paging, external observability connectors,
expanded agent actions, triage predictions and the responder overview are still tracked as work
in progress in `plans/intelligence-engine/roadmap-implementation.json`. Implemented code and
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
