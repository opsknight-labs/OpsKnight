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
| `intelligence.feedback` | admin, responder | Reserved for suggestion feedback |
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

## Not yet implemented

Correlation of related alerts, automatic grouping, any delay before paging, change correlation,
probable cause, runbook ranking, AI assistant features and adaptive learning are future stages.
Each will be introduced behind its own certification gate and will not change paging behaviour
until that gate has passed.
