# Ingestion p50 regression with the lane in-process: diagnosis and fix (2026-11-09/10)

Measured on one developer machine (Apple silicon, 12 cores; PostgreSQL 16 + pgvector in Docker) shared
with other agents. Host load averages are recorded in every report file (`host`) and below. The authoritative
runs remain the nightly / `ci:full` jobs.

## The problem

`ingestion-ab-2026-11-08-local.json`: with the lane busy in the same process and Prisma pool (`integrated`),
`processEvent` p50 was +7.61 ms over the lane-off arm (limit +2 ms), p99 +4.04 ms (limit +10 ms), in all six
repetitions.

## Diagnosis

The benchmark now records attribution data for every timed burst (`diagnostics` in each sample):
event-loop delay and utilisation (ELU), process CPU, GC pauses, Prisma pool wait on the ingestion
pool, engine-timed statements on the ingestion pool per event, and sampled `pg_stat_activity` wait
events. `--cpu-profile-dir` profiles only the timed window.

Findings, from the cleanest measurements (load average 4 to 8, `*-2026-11-09-local.json`), medians per arm:

| Run (6 reps, 200 events, concurrency 8)                | Pool wait / event | Ingestion-pool statement ms / event | Main-thread ELU | Lane items per burst | p50 delta | p99 delta |
| ------------------------------------------------------ | ----------------- | ----------------------------------- | --------------- | -------------------- | --------- | --------- |
| `before-shared-pool-no-yield` (old behaviour)          | 0 → **1.0 ms**    | 2.3 → **4.3** (includes lane's)     | 0.82 → 0.87     | 31                   | **+2.23** | +7.10     |
| `own-pool-no-yield` (lane pool only)                   | 0 → 0             | 2.6 → 3.0                           | 0.82 → 0.88     | 37                   | **+2.04** | -21.34    |
| `after` (lane pool + ingestion yield, the shipped fix) | 0 → 0             | 2.1 → 2.3                           | 0.81 → 0.83     | 4                    | **+0.43** | **+1.33** |

1. **Prisma pool queueing (fixed by the lane pool).** On the shared pool the lane's transactions held
   connections that `processEvent` waited for: about 1 ms of pool wait per event on a quiet host, and
   13 ms per acquisition in a smoke run at load 8 to 11 (`prisma_client_queries_wait_histogram_ms`, 0 in
   the lane-off arm). The lane's own pool removes this completely (0.00 ms in every candidate run).
2. **Main-thread saturation (event loop).** Ingestion at concurrency 8 already keeps the main thread
   about 80% busy (ELU 0.81 to 0.83 with the lane off; the profile is mostly Prisma request and response
   handling in JS). The lane's own JS work (Prisma calls, hashing, scoring) and the extra allocation
   (GC 45 to 50 ms per burst rising to 55 to 65 ms, and up to 767 ms in one profiled run) add 5 to
   7 points of ELU. With the loop close to saturation that turns directly into queueing for every
   ingestion continuation: p50 latency tracks concurrency / throughput. Event-loop delay p50 stayed at
   about 1 ms, so this is many small tasks queueing, not one long block. No single synchronous hot spot
   stood out: the alert-indexer digest and canonical JSON were each under 1% of the burst profile.
3. **PostgreSQL and engine contention.** Ingestion statements took longer while the lane worked
   (2.6 → 3.0 ms per event with the lane on its own pool). When the Docker disk was saturated by other
   work (WALWrite / DataFileImmediateSync waits, TRUNCATE taking 3+ s), the lane's I/O inflated
   ingestion statements far more (for example 5.3 → 38.6 ms per event), and pool separation cannot
   help with that.
4. **Not a cause:** the wake publisher's `pg_notify` runs in both arms (ingestion signals regardless
   of the setting) and showed no pool wait in the lane-off arm; lock waits stayed at 0 to 4 backends
   with no relation-lock pattern.

So the pool fix alone (`own-pool-no-yield`, +2.04 ms) does not meet the contract. The rest of the cost is
shared CPU, event loop and database, which only doing less lane work during a burst removes.

## Fix

- **Own pool in a shared process** (`src/lib/intelligence/jobs/lane-pool.ts`, `database-workload.ts`,
  `prisma.ts`). Details in `docs/architecture/intelligence.md` → "Backpressure and budgets".
- **Yield to in-process ingestion** (`src/lib/ingestion/activity.ts`,
  `src/lib/intelligence/jobs/ingestion-yield.ts`). The lane runs one item at a time at 20% duty while
  the average number of events in flight is at least 1, with hysteresis. During a burst the lane
  completes 1 to 5 items instead of 30 to 40 (it never stops). Outside bursts, and in the storm
  benchmark (no in-process ingestion), its throughput is unchanged.
- The dedicated `intelligence-worker` role is unaffected: no lane pool and no in-process ingestion.

## Gate results after the fix

See the table in `README.md` (A/B section) for every run with host load. Summary:

- Clean host (load 4.9 to 8.5): `ingestion-ab-after-2026-11-09-local.json` **PASS**: p50 +0.43 ms, p99 +1.33 ms.
- Overloaded host (load 9 to 22; baseline p50 itself swung between 18 and 167 ms within one run, and the
  Docker VM clock fell 15 minutes behind the host, a sign the VM was stalled): the 12-repetition runs
  and the CI-shape runs are **not judgeable**. They are kept for completeness:
  - `ingestion-ab-before-12rep`: FAIL, p50 +14.96 / p99 +61.03 (old behaviour).
  - `ingestion-ab-after-12rep`: FAIL, p50 +2.61 / p99 +58.84. In the four repetitions where the host
    was quiet (baseline p50 about 20 ms) the paired deltas were -1.8, -1.5, +1.3 and +47 ms (the last one
    was taken during the transition into the stall).
  - `ingestion-ab-ci-shape-before`: FAIL, p50 +8.41 / p99 +63.01 (old behaviour).
  - `ingestion-ab-ci-shape-after`: FAIL because **the lane completed no item during three of the six
    bursts** (`lane idle` breach). p50 -30.58 and p99 -133.52 ms are meaningless because of that. With
    ingestion statements at 30 to 80 ms per event, one lane item (at 20% duty, pauses of at most 1 s)
    did not finish inside a 2 to 5 s burst. The gate condition is unchanged. The report now also records
    `laneItemsActive` (handlers that ran during the burst, finished or not), for context only.

Re-runs on 2026-11-10 (host load 9 to 13, still degraded):

- `ingestion-ab-after-rerun-2026-11-10-local.json`: the numbers PASS (p50 -20.82, p99 -11.51), but the run is
  **not judgeable**. One candidate event took **899 s** and the process sat idle (ELU 0.00) for that
  burst. The Docker VM clock was 13 to 15 minutes behind the host at the time. That is the VM stalling,
  not the lane. Integration tests on the same VM hung for about 900 s inside `resetDatabase` in the
  same window, with the lane pool on and with it off (`INTELLIGENCE_LANE_DATABASE_POOL_SIZE=0`).
- `ingestion-ab-ci-shape-after-rerun-2026-11-10-local.json`: **FAIL**, lane idle in 2 of 6 bursts.
  `laneItemsActive` was 1 in all six: a lane handler was running during every burst, but in two it did
  not finish inside the burst. At concurrency 16 the ingestion pool of 10 is itself saturated (pool wait
  13 to 48 ms per event in both arms), so this shape mostly measures ingestion queueing on its own pool.

**Verdict.** The only clean measurement passes with a wide margin (p50 +0.43 ms, p99 +1.33 ms). The
pre-fix behaviour failed p50 in every clean and dirty run. The CI shape is unproven: in that shape the
lane does so little during a burst that the gate's "lane busy" check fails, and that check is unchanged.

## Storm (lane throughput)

`storm-20k-shared-pool-2026-11-10-local.json` (1,873 s) against `storm-20k-own-pool-2026-11-10-local.json`
(1,889 s), with the same per-kind medians and the same 8 transient failed attempts: no throughput lost to
the lane pool. Both runs were dominated by Docker VM stalls. The 100k / 10k storm gate was not
re-measured (stopped during seeding at load 43 to 64). See `README.md`.

## Open

- Re-run the CI-shape A/B (`--concurrency 16 --events 300 --backlog 1500`) on an idle host or in CI. If
  the lane still completes nothing during a burst, the gate correctly reports that contention was not
  exercised. Do not relax that check. Either lengthen the CI burst or record that the lane stops
  competing during bursts by design.
- `deploy/scripts/validate-runtime-capacity.cjs` does not count the lane pool (up to 10 extra connections
  per shared process while the lane is enabled and busy). The lane is opt-in, so this is documented
  rather than added to the validator's demand. Add it if operators want the validator to fail closed.
