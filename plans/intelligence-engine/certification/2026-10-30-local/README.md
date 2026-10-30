# Local evidence, 2026-10-30

These are synthetic fixtures on a shared development Mac and local PostgreSQL containers. They are
repeatable implementation evidence, not dedicated-hardware deployment certification.

- `storm.json`: Node 20.20.2, engine 1.3.0, one million historical fingerprints, 10,000 new incidents,
  50 services, batch 50/concurrency eight. All 40,000 handler operations completed with zero failures
  and zero dead letters. Drain: 280.7 seconds (35.6 incidents/second). Similarity analysis p50/p99:
  88.9/249.7 ms; indexing 38.0/148.5 ms; correlation 17.0/30.0 ms; response 22.2/43.0 ms.
- `storm-before-selective-fts.json`: the earlier broad OR retrieval took 2,123 seconds and recovered
  eight retries. It used Node 22 and overlapped other checks. Runtime and host load differ, so this is
  diagnostic history, not a controlled speedup claim. Both runs finished with zero dead letters.
- `ingestion-ab.json`: eight alternating paired repetitions, 1,500 events per arm, concurrency 16,
  3,000 queued background incidents. Every candidate run performed real handler work during the
  measured burst; all 24,000 ingestion attempts succeeded. Median candidate/baseline ratios: p50
  1.061, p99 1.076, throughput 0.914. The harness's noise-relative verdict is
  `NO_DETECTABLE_DIFFERENCE`; this does not prove parity or certify an acceptable regression budget.
  The harness alone bypasses paging backpressure because it publishes paging intents without running
  a paging delivery worker. This measures worst-case active-lane contention and changes no runtime code.
- `query-plans.json`: read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` from 1,010,000 fingerprints.
  It exercises service/time, stored full-text, GiST KNN, queue claim arms and the change time window.
  The earlier plans are retained separately. Query shapes/samples and host load differ; their timings
  are not a paired comparison. The final claim queue and change table are empty, which limits those
  plans' load evidence. The storm separately exercises the loaded queue.

History was seeded in bounded committed batches with all production triggers enabled. The measured
runs reused validated, engine-matched synthetic history; replacing the burst took 11/16 seconds and
is excluded from drain time. No production data, credentials or live AI provider were used.
