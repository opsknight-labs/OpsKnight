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
every candidate run, 0 failures. Median paired delta **p50 +7.61 ms (limit +2) — FAIL**, p99 +4.04 ms
(limit +10). Candidate p50 was higher in all six repetitions (+5 to +17 ms), so this is a consistent
cost, not noise: the harness runs the lane in the _same Node process and pool_ as ingestion (the
`integrated` worst case), so lane CPU work (hashing, scoring) shares the event loop. **OPEN**: re-run on an
idle host; if it holds, lane CPU work needs a worker thread in `integrated`, or the dedicated
`intelligence-worker` (default in every split package) should be required above a size threshold.

## Query plans (`tests/load/intelligence-query-plans.ts`)

`query-plans-2026-11-08-local.json` (21k history): **PASS**. Seven queries index-backed, including the
production claim statement and the AUTO paging-outbox lookup (`idx_background_job_intelligence_paging`);
the repair watermark and embed page are recorded as not judged below 200k rows, where the planner
rightly prefers a sequential scan. `query-plans-100k-2026-11-08-local.json` is the same run at 100k with
`--no-gate`, kept for its timings.
