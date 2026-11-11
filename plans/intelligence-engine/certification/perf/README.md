# Intelligence performance gates: local measurements

**Status: NOT PASSING locally. Do not read these files as certification.** All runs were on one
developer machine (Apple silicon, PostgreSQL 16 + pgvector in Docker) shared with several other
agents' builds and test suites; host load averages are recorded per run. The authoritative runs are the
nightly / `ci:full` jobs in `.github/workflows/intelligence-performance.yml`, which use 1M history.

Contracts (unchanged): ingestion p99 at most +10 ms and p50 at most +2 ms with the lane busy; a 10k storm
drains in under 600 s with no dead letters and per-kind p99 under 10 s; every hot query is index-backed.

## Storm drain (`tests/load/intelligence-storm.ts`)

| File                                                   | History | Burst | Drain       | Executions per incident per kind | Handler busy         | Host load | Result             |
| ------------------------------------------------------ | ------- | ----- | ----------- | -------------------------------- | -------------------- | --------- | ------------------ |
| `storm-100k-before-fix-2026-11-08-local.json`          | 100k    | 10k   | **7,684 s** | 1.22                             | ~0.05 (from medians) | ~10–20    | FAIL               |
| `storm-20k-probe-2026-11-08-local.json`                | 20k     | 1k    | 104 s       | 3.0                              | 0.82                 | ~20       | (probe, not gated) |
| `storm-100k-burst500-before-fix-2026-11-08-local.json` | 100k    | 500   | 899 s       | **17.4**                         | 0.79                 | 22–55     | (probe)            |
| `storm-100k-burst500-after-fix-2026-11-08-local.json`  | 100k    | 500   | 16.2 s      | 1.0                              | 0.82                 | ~11–35    | (probe)            |
| `storm-100k-rerun-2026-11-08-local.json`               | 100k    | 10k   | **703.2 s** | 1.0                              | 0.80                 | 20–37     | **FAIL** (> 600 s) |

**Cause found and fixed.** The storm fixture seeds history fingerprints without `alertNormalizationHash`
(91,800 of 100,000). The per-cycle updated-incident repair added in the robustness work classifies those as
`staleSource` and re-indexes history _during_ the benchmark (up to 17 executions per new incident), and,
unlike every other sweep, the benchmark could not disable it. The repair is now paced to 5 s
(`LaneState.lastUpdatedRepairAt`, `UPDATED_REPAIR_INTERVAL_MS`) and the benchmarks reset it like the other
sweeps. After the fix: one execution per incident per kind, handler-bound (80% busy), 11x faster.

**2026-11-10, after the ingestion p50 fix (lane pool):** the lane now has its own Prisma pool in shared
processes, and the storm runs in-process (`integrated`), so the pair below checks that this did not
reduce drain throughput. The storm has no in-process ingestion, so the ingestion yield never engages.

| File                                          | Lane pool        | History / burst | Drain   | Cycles / avg   | Handler busy | Failed attempts | Host load | Result |
| --------------------------------------------- | ---------------- | --------------- | ------- | -------------- | ------------ | --------------- | --------- | ------ |
| `storm-20k-shared-pool-2026-11-10-local.json` | shared (`=0`)    | 20k / 1k        | 1,873 s | 2,736 / 685 ms | 0.50         | 8               | 10–13     | probe  |
| `storm-20k-own-pool-2026-11-10-local.json`    | own (default 10) | 20k / 1k        | 1,889 s | 3,869 / 488 ms | 0.50         | 8               | 10–43     | probe  |

The two are equal within noise, so the lane pool does not cost drain throughput. Both are about 18x
slower than the 104 s probe on 2026-11-08. The Docker VM was stalling for about 15 minutes at a time
during these runs (its clock was 13 to 15 minutes behind the host), which accounts for roughly two such
stalls per run. The 100k / 10k gate run was **stopped during seeding** at load 43 to 64. A run on this host
in that state could not be judged, so **the storm gate was not re-measured** after this change.

**OPEN.** At 703 s the gate still fails on this loaded host. Re-run on an idle host (`--reuse-history`
avoids reseeding) and diagnose. Data to start from (after fix, 100k):

| Kind               | p50      | p95      | p99      |
| ------------------ | -------- | -------- | -------- |
| INDEX_INCIDENT     | 39.8 ms  | 111.4 ms | 235.2 ms |
| ANALYZE_INCIDENT   | 83.3 ms  | 216.2 ms | 663.6 ms |
| CORRELATE_INCIDENT | 125.0 ms | 346.7 ms | 580.9 ms |
| ANALYZE_RESPONSE   | 85.1 ms  | 497.2 ms | 869.3 ms |

Slowest by total time: CORRELATE_INCIDENT and ANALYZE_RESPONSE at the median, ANALYZE_RESPONSE at the
tail. ANALYZE_INCIDENT's dominant query is the full-text candidate source:
`query-plans-100k-2026-11-08-local.json` shows it at **291.8 ms** (Bitmap Heap Scan on
`idx_incident_fingerprint_search`, ~400 rows ranked) against 13.8 ms same-service and 27.3 ms trigram. An
OR-of-three-words variant measured **902 ms / 20,834 rows** vs **218 ms / 398 rows** for the two-word
AND, so the OR form was reverted. Note the synthetic vocabulary is tiny (5 common, 20 nouns, 12
qualifiers), so "rare" words each match ~5% of history; production vocabularies are far more selective.

## Ingestion A/B (`tests/load/intelligence-ingestion-ab.ts`)

`ingestion-ab-2026-11-08-local.json`: 6 repetitions, 200 events, concurrency 8, backlog 800, lane busy in
every candidate run, 0 failures. Median paired delta **p50 +7.61 ms (limit +2): FAIL**, p99 +4.04 ms
(limit +10). Candidate p50 was higher in all six repetitions.

**Diagnosed and fixed on 2026-11-09:** see `ingestion-p50-diagnosis-2026-11-09.md`. Causes: the lane
queued ahead of `processEvent` on the shared Prisma pool, and its CPU and database work competed with
an event loop that ingestion already keeps about 80% busy. Fix: the lane gets its own pool in shared
processes and backs off (one item at a time, 20% duty) while in-process ingestion is busy.

| File (2026-11-09/10)                         | Lane behaviour              | Shape (reps/events/conc/backlog) | Host load            | p50 delta | p99 delta | Result                               |
| -------------------------------------------- | --------------------------- | -------------------------------- | -------------------- | --------- | --------- | ------------------------------------ |
| `ingestion-ab-before-shared-pool-no-yield-…` | old (shared pool, no yield) | 6/200/8/800                      | 4.2–5.4              | +2.23     | +7.10     | FAIL (diagnosis)                     |
| `ingestion-ab-own-pool-no-yield-…`           | own pool only               | 6/200/8/800                      | 4.9–5.0              | +2.04     | -21.34    | FAIL (diagnosis)                     |
| `ingestion-ab-after-2026-11-09-local.json`   | **fix** (own pool + yield)  | 6/200/8/800                      | 7.7–8.5              | **+0.43** | **+1.33** | **PASS**                             |
| `ingestion-ab-before-12rep-…`                | old                         | 12/200/8/800                     | 3.0–8.9, VM stalled  | +14.96    | +61.03    | FAIL, not judgeable                  |
| `ingestion-ab-after-12rep-…`                 | fix                         | 12/200/8/800                     | 8.9–19.2, VM stalled | +2.61     | +58.84    | FAIL, not judgeable                  |
| `ingestion-ab-ci-shape-before-…`             | old                         | 6/300/16/1500                    | 15.4–15.8            | +8.41     | +63.01    | FAIL, overloaded host                |
| `ingestion-ab-ci-shape-after-…`              | fix                         | 6/300/16/1500                    | 14.1–15.1            | -30.58    | -133.52   | **FAIL: lane idle** in 3 of 6 bursts |

| `ingestion-ab-after-rerun-2026-11-10-local.json` | fix | 6/200/8/800 | 10.1–10.8, VM stalled | -20.82 | -11.51 | PASS by the numbers, **not judgeable** (one event took 899 s) |
| `ingestion-ab-ci-shape-after-rerun-2026-11-10-…` | fix | 6/300/16/1500 | 8.9–12.8 | -8.35 | -91.15 | **FAIL: lane idle** in 2 of 6 bursts (a handler was running in all 6) |
| `ingestion-ab-after-2026-11-10b-local.json` | fix (own pool + yield, **in-process lane**, before the worker thread) | 6/200/8/800 | 2.8 → 3.1 (quiet host) | +0.45 | +2.35 | PASS |
| `ingestion-ab-ci-shape-after-2026-11-10b-local.json` | same state, **in-process lane** | 6/300/16/1500 (CI shape) | 2.1 → 2.7 (quiet host) | +1.23 | **+15.32** | **FAIL (p99)** |

The two `2026-11-10b` rows are historical evidence from the phase-1 p50 work (`wip/intel-p1-ingest-p50`, run
04:54 UTC on a quiet host): the in-process lane with its own pool and the 50 ms-window yield, before the
lane moved into a worker thread. They show the in-process configuration passing the small shape and failing
the CI shape on p99; they are the baseline the thread lane is compared against below.

"Not judgeable": on those runs the lane-off baseline p50 itself varied 3.5–8x within one run and the Docker
VM clock fell 15 minutes behind the host. Both arms were measured on that degraded host, so the
pairs measure the disturbance, not the lane.

### Pre-paging noise controls wired into ingestion (2026-11-09/10, all FAIL, host heavily loaded)

`--noise-controls on` turns every control ON for the bench services, tuned so each event runs the full
lookup (dedup target, flapping statuses, storm count and parent in one statement under the savepoint
and 5 ms server-side timeout) without changing the outcome. Same contract, same thresholds. The host
was shared with other agents' builds and suites throughout: load averages 26–38 for the A/B runs and
17→5 during the burst. Deltas are median paired (candidate − baseline).

| File                                                          | Candidate            | History                       | Events/arm | p50 Δ         | p99 Δ          | Noise fail-open (candidate)   | Result |
| ------------------------------------------------------------- | -------------------- | ----------------------------- | ---------- | ------------- | -------------- | ----------------------------- | ------ |
| `ingestion-ab-noise-off-2026-11-09-local.json`                | lane busy, noise OFF | 0                             | 6 × 200    | **+23.26 ms** | **+100.72 ms** | —                             | FAIL   |
| `ingestion-ab-noise-on-2026-11-09-local.json`                 | lane busy, noise ON  | 0                             | 6 × 200    | **+22.37 ms** | **+108.79 ms** | deadline 1,176 / 1,200 (98%)  | FAIL   |
| `ingestion-ab-noise-on-no-lane-2026-11-09-local.json`         | lane idle, noise ON  | 0                             | 6 × 200    | **+4.97 ms**  | **+14.52 ms**  | deadline 291, error 6 (25%)   | FAIL   |
| `ingestion-burst10k-noise-on-history1m-2026-11-09-local.json` | lane busy, noise ON  | 1.01M incidents, 1.01M alerts | 1 × 10,000 | **+12.31 ms** | +4.27 ms       | deadline 6,211 / 10,000 (62%) | FAIL   |

Reading:

- **With the lane busy, noise ON adds nothing measurable on top of the lane** (+22.4 vs +23.3 ms p50,
  +108.8 vs +100.7 ms p99, within this host's run-to-run spread): the lane-in-process cost dominates and
  fails the gate on its own, as on 2026-11-08.
- **The hook alone costs about one deadline**: +5.0 ms p50, +14.5 ms p99 with the lane idle. The hook
  does three round trips inside the deadline (savepoint, timeout, one combined read) and one after it
  (rollback); on this host one Prisma interactive-transaction round trip measured 0.5–2 ms, so the
  5 ms budget is routinely spent, and a fail-open still pays for the work done before the deadline plus
  the rollback. **OPEN**: re-run on an idle host; if it holds, cut round trips before any service is
  switched ON at scale (options: run the single read on a separate pooled connection with its own
  timeout so no savepoint is needed, or set the timeout once per transaction instead of per hook).
- **Effectiveness under load is low.** With the lane busy 62–98% of evaluations failed open on the
  deadline, so the controls would mostly not act. That is the designed safe behaviour (the event pages
  normally) but it is not useful noise reduction on a host this loaded.
- The burst over 1M history ran without a single ingestion failure. In the candidate 659 storm
  groupings were recorded (10k events on 4 services exceed the 1,000-in-60 s storm threshold), so the
  candidate did slightly less paging work than the baseline in that run.

### Re-run on a lightly loaded host, savepoint route vs dedicated lookup pool (2026-11-10)

Same contract, same thresholds, same arguments (6 × 200 events, concurrency 8, backlog 800, 4
services; burst 1 × 10,000, concurrency 16, 1.01M resolved incidents and 1.01M alerts per arm). Load
averages (1-minute) at the start/end of each run are given; the host was still shared but far quieter
than on 2026-11-09. "Savepoint" is the hook as first wired (reads on the event transaction, four round
trips); "pool" is the dedicated two-connection lookup pool (one round trip, the default since
`perf(intelligence): run pre-paging lookups on a dedicated deadline-bounded pool`).

| File                                                                    | Candidate                  | Load      | p50 Δ         | p99 Δ         | Noise fail-open (candidate) | Result   |
| ----------------------------------------------------------------------- | -------------------------- | --------- | ------------- | ------------- | --------------------------- | -------- |
| `ingestion-ab-noise-off-2026-11-10-run1-local.json`                     | lane busy, noise OFF       | 1.2 → 3.9 | +1.61 ms      | −0.16 ms      | —                           | PASS     |
| `ingestion-ab-noise-off-2026-11-10-run2-local.json`                     | lane busy, noise OFF       | 2.7 → 3.3 | **+2.41 ms**  | +3.22 ms      | —                           | FAIL     |
| `ingestion-ab-noise-on-2026-11-10-savepoint-local.json`                 | lane busy, noise ON        | 3.9 → 4.5 | **+6.19 ms**  | **+11.33 ms** | deadline 168 / 1,200 (14%)  | FAIL     |
| `ingestion-ab-noise-on-2026-11-10-pool-local.json`                      | lane busy, noise ON        | 3.3 → 3.7 | **+4.45 ms**  | −0.41 ms      | deadline 1 / 1,200          | FAIL     |
| `ingestion-ab-noise-on-no-lane-2026-11-10-savepoint-local.json`         | lane idle, noise ON        | 4.5 → 4.6 | **+3.68 ms**  | −9.28 ms      | deadline 91 / 1,200 (8%)    | FAIL     |
| `ingestion-ab-noise-on-no-lane-2026-11-10-pool-local.json`              | lane idle, noise ON        | 3.7 → 3.5 | +1.14 ms      | +0.34 ms      | deadline 1 / 1,200          | **PASS** |
| `ingestion-burst10k-noise-on-history1m-2026-11-10-savepoint-local.json` | lane busy, noise ON, burst | 4.6 → 6.3 | **+8.81 ms**  | −9.21 ms      | deadline 6,258 / 10,000     | FAIL     |
| `ingestion-burst10k-noise-on-history1m-2026-11-10-pool-local.json`      | lane busy, noise ON, burst | 3.5 → 5.3 | **+12.56 ms** | **+17.45 ms** | deadline 2,774, error 1     | FAIL     |

Reading:

- **The hook alone now meets the contract** on this host: +1.14 ms p50 / +0.34 ms p99 with the lane idle
  on the pool route, against +3.68 ms p50 on the savepoint route measured minutes earlier. Fail-open
  on the deadline fell from 8–14% to 1 in 1,200, so the controls actually act instead of mostly
  paging through.
- **"All features ON vs everything OFF" still FAILS on p50** (+4.45 ms, limit +2). The lane on its own
  sits at the edge of the p50 budget (+1.61 PASS and +2.41 FAIL in two runs 30 minutes apart), and the
  hook's ~1 ms comes on top. The p99 budget holds (−0.41 ms). Closing this needs the lane cost
  reduced (see the 2026-11-08 notes: worker thread or dedicated `intelligence-worker`), not the hook.
- **The 10k burst over 1M history FAILS** on both routes (single repetition, so no confidence interval;
  the two baselines differ by 5 ms p50 run to run). No ingestion event failed. At concurrency 16 the
  two-connection pool queues: 28% of evaluations failed open on the deadline (63% on the savepoint
  route). The bench policy's storm threshold (1,000 in 60 s) is exceeded by 10k events on 4 services, so
  the candidate also did different work: 3,353 storm groupings (child link, provenance event, parent
  timeline entry, service-notification roll-up) on the pool route, where more evaluations completed.
  **OPEN**: a burst arm whose storm threshold is above the burst size, and a pool sized to the event
  concurrency, to separate the hook's cost from the grouping work.

### Lane in a worker thread (2026-11-10 onwards, CI shape 6 reps / 300 events / concurrency 16 / backlog 1500)

<!-- thread-lane-tables -->

Raw files, one per invocation (`aN` is the attempt number inside its campaign; `-discarded` marks a run
the host check rejected, kept for the record and never averaged in):

- `ingestion-ab-ci-shape-thread-before-yield-fix-2026-11-10-a*` and
  `ingestion-ab-noise-on-thread-before-yield-fix-2026-11-10-a*`: thread lane at `30bb4d8aa`, before the
  burst-start yield (`e2cf0ce5d`). `storm-20k-thread-2026-11-10-local.json` is the storm drain of that state.
- `ingestion-ab-ci-shape-thread-yield-fix-2026-11-10-a*`, `ingestion-ab-noise-on-thread-yield-fix-2026-11-10-a*`
  and `ingestion-ab-ci-shape-in-process-yield-fix-2026-11-10-a*`: at `7d95e616e`, with the burst-start
  yield, judged by the benchmark's own host check.

## Query plans (`tests/load/intelligence-query-plans.ts`)

`query-plans-2026-11-08-local.json` (21k history): **PASS**. Seven queries index-backed, including the
production claim statement and the AUTO paging-outbox lookup (`idx_background_job_intelligence_paging`);
the repair watermark and embed page are recorded as not judged below 200k rows, where the planner
rightly prefers a sequential scan. `query-plans-100k-2026-11-08-local.json` is the same run at 100k with
`--no-gate`, kept for its timings.
