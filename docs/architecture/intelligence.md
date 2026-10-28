# OpsKnight Intelligence (AIOps)

OpsKnight Intelligence learns from incident history to help responders. The first release surfaces
**similar past incidents**. It is disabled by default, configured entirely from
**Settings → Intelligence**, and runs entirely off the paging path.

This document is the architecture and safety contract. Implementation lives in
`src/lib/intelligence/`.

## Safety contract

1. **Nothing is written when an incident is created.** New incidents are found by a keyset
   watermark with a 30 second safety lag, so a late-committing transaction can never be skipped.
   `src/lib/events.ts` and `src/lib/incidents/creation.ts` do not import intelligence; an
   architecture test enforces this.
2. **Intelligence never changes routing, paging, escalation or notifications.** Today it only
   reads incidents and writes to its own tables. No incident, alert, note or timeline row is ever
   modified (also enforced by an architecture test).
3. **Off means off.** The master switch and per-policy mode (`OFF`, `SHADOW`, `SUGGEST`) gate every
   query and write. `SHADOW` analyses and records but shows nothing. `AUTO` exists in the schema
   but cannot be selected until it has passed its certification gates.
4. **No environment variables.** All settings are database-backed, revision-locked and audited. An
   architecture test fails if the module reads `process.env`.
5. **Fail safe.** Every cycle is contained: a failing handler, probe or database error degrades
   intelligence and never propagates.
6. **A suggestion cannot leak an incident.** Every suggested precedent is filtered through the same
   incident visibility rule as the rest of the application, and stored evidence contains only
   numeric scores, never text from another incident.

## How it works

```
Incident created ──(no write)──┐
                               ▼
        discovery sweep  ── keyset watermark + 30s lag, plus anti-entropy repair
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
- **Hosting.** The lane runs in the `integrated`, `worker` and `general-worker` process roles. A
  disabled install reads one settings row every 30 seconds.

### Similarity

Candidates come from three bounded sources: recent incidents of the same service, full-text
matches, and trigram matches when `pg_trgm` is installed. Full-text search is built into
PostgreSQL, so a managed database without extension rights simply uses the full-text tier; the
Settings page shows which tier is active. Candidates are re-ranked in TypeScript from named
components (wording, labels, service, recency, outcome). Service, recency and outcome can never
create a match by themselves, and the match percentage is a ranking signal, **not a probability**.

## Backpressure and budgets

- **Paging first.** The lane pauses while the oldest due `ESCALATION` or `NOTIFICATION` job has
  waited longer than the configured threshold, and resumes only below half of it.
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

| Capability | Granted to | Purpose |
| :--- | :--- | :--- |
| `intelligence.suggestions.read` | every role | See suggestions on incidents (visibility-filtered) |
| `intelligence.read` | admin, responder, auditor | View the Settings → Intelligence page |
| `intelligence.feedback` | every role except auditor | Rate suggestions (visibility-checked, rate-limited, one live verdict per person) |
| `intelligence.manage` | admin | Change settings and policies |

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
  policy version is a new identity space and never silently joins old groups.
- **Windows.** A window is derived from the incident's own time (replays are deterministic), slides
  while incidents keep arriving, and never passes its hard ceiling. Groups are scoped to one service.
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

Automatic grouping remains unimplemented and unavailable.

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
job proposes edges when incidents on one service repeatedly open within ten minutes after another
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
intelligence data. With AI enabled it answers free-form questions using a language model and three
read-only tools (search incidents, get an incident, get its intelligence). Tools run under the asking
user's own permissions through the same visibility rules as the rest of the application, so the model
can never read more than the user can. **It has no write tools and cannot change anything**; an
architecture test enforces that the assistant code performs no database writes. Conversations live in
the browser only; OpsKnight stores nothing, and audit entries hold metadata (user, provider, model,
token counts), never prompts or answers.

**Prompt-injection posture.** The browser can send only user and assistant turns (never a system turn),
bounded in number and size. The system prompt tells the model that tool output and incident text are
data, never instructions. That prompt is defence in depth only: authority never rests on it, because
tools are read-only and permission-checked. Model output is rendered as plain text; only same-app
`/incidents/…` and `/runbooks/…` paths become links.

**Gateway.** Providers (OpenAI, Anthropic, Google, and any OpenAI-compatible endpoint such as Ollama,
vLLM, LiteLLM or OmniRoute) are added in the UI. API keys are encrypted at rest, registered in the
encryption registry, and never returned to the browser. The runtime is the AI SDK 6 line (the product
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
- **Test connection.** Each saved provider has a button that sends one fixed tiny prompt through the same
  guarded fetch and reports only a fixed category (connected, unreachable, rejected, timeout), never
  provider error text.
- **Resilience.** Per-provider circuit breakers (open after three consecutive failures, one probe after
  30 seconds), bounded timeouts, and fallback only before the first token of a streamed answer so two
  answers are never spliced. When AI is unavailable, over budget or rate limited, the assistant answers
  in basic mode instead of failing.
- **Cost controls.** Per-user requests per minute, a global daily token budget (UTC day), a cap on
  answer length and on model/tool round trips. Credential-shaped text is redacted from everything sent
  to a model, including tool results.

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
- **Unusual volume.** A service with at least five incidents this week and three times its own recent
  weekly norm (a floor of one per week keeps quiet services from flapping).
- **Last 7 days.** Aggregate counts (incidents analyzed, findings by kind, ratings, changes recorded,
  stuck work items), visible to administrators only and naming no service or incident.
- **Suggestion quality.** Responder thumbs on similar-incident suggestions, bucketed by match score.
  When there are at least 20 ratings and low-scoring suggestions are mostly unhelpful, it proposes a
  higher minimum similarity, judged by the lower bound of the Wilson interval so a few thumbs-up cannot
  justify a change. It never proposes lowering the threshold. Applying it is a button that publishes a new
  audited global policy version; the suggestion is recomputed on the server and must match what was
  shown, so a stale page or crafted request cannot set an arbitrary value. Aggregate feedback is visible
  only to administrators.

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

## Observability

`/api/health?mode=readiness` includes an `intelligence` check that is `healthy`, `degraded` (paused to
protect paging, or no recent cycle) or `disabled`, and is never `unhealthy`, so an optional advisory
lane can never take a replica out of rotation. Five gauges are added to the metrics scrape: ready
queue depth, oldest ready age, dead letters, lane paused, and seconds since the last cycle. Work items and
AI calls emit OpenTelemetry spans (`intelligence.work`, `intelligence.ai.generate`,
`intelligence.ai.stream`) through the OpenTelemetry API, which is a no-op until a tracer provider is
registered. Span attributes are bounded categories and token counts; never incident ids, prompts,
answers or error messages.

## Not yet implemented

Automatic grouping, any delay before paging, write actions from the assistant, scheduled digest
delivery (a last-7-days summary is shown on demand in Insights), embedding-based search, and learned
correlation rules are future stages. The evidence and the open gates are tracked in
`plans/intelligence-engine/certification/README.md`. MCP exposure is delivered by the
native MCP work, not here. Each will be introduced behind its own certification gate and will not change
paging behaviour until that gate has passed.
