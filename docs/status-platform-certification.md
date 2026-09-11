# Status platform certification

This repository provides the deployment controls and repeatable load profiles needed for status
page and notification certification. A merge is not evidence that an environment met the scale
targets. Record an execution for each release candidate before calling it certified.

## Required environment

Use an isolated staging environment with production-like PostgreSQL, serving-store, worker pool,
provider sandbox, and monitoring. Seed the planned service, incident, subscriber, and notification
volumes before the test. Keep the web, scheduler, critical worker, bulk worker, and projector as
separate processes with their production connection budgets.

Run the online-index guard before the workload:

```sh
npm run prisma:indexes:status-platform
```

## Public and mixed workload

The profile below combines snapshot-only public reads, authenticated internal reads, and optional
signed provider-feedback ingestion. It is safe to run feedback only against a dedicated provider
sandbox because every event is persisted idempotently.

```sh
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e PUBLIC_RPS=5000 \
  -e INTERNAL_VUS=50 \
  -e AUTH_COOKIE='next-auth.session-token=...' \
  --summary-export=artifacts/status-platform-k6.json \
  scripts/load/status-notification-certification.js
```

To include feedback ingestion, add `FEEDBACK_RPS` and the staging-only
`NOTIFICATION_PROVIDER_FEEDBACK_SECRET`. Never put a production secret in a shell history, k6
output, repository, or release artifact.

The existing `scripts/load/status-notification-scaling.js` remains the fast 1,000-RPS smoke
profile. The certification profile has the 5,000-RPS target and the mixed internal workload.

## Required scenarios

Run and retain artifacts for all of these scenarios:

1. Snapshot/history scale datasets: 10 services/1k incidents, 100/10k, 500/100k, and 1,000/1M.
2. Subscriber fanout batches: 1k, 10k, 100k, and 1M recipients with a provider sandbox.
3. Public traffic: 100, 500, 1,000, and 5,000 RPS.
4. Mixed workload: 1,000 public RPS, critical responder traffic, internal incident traffic, and a
   1M-recipient campaign.
5. Failure drills: provider 429, provider 500, two-second provider latency, a 30-minute provider
   outage, PostgreSQL pressure, and bulk-worker termination.
6. Privacy and route checks: a disclosure-tightening update must fail closed before the new
   projection is published; route replacement must publish the new route before deleting the old.

## Acceptance record

For every run, save a dated directory with:

- k6 JSON output and command parameters with secrets removed;
- PostgreSQL CPU, connections, locks, query latency, replication lag, and error-rate graphs;
- web and worker CPU/memory/restart counts; serving-store latency/errors; queue depth and oldest
  age by traffic class; provider accepted/429/5xx rates; bounce and complaint counts;
- snapshot build phase duration, snapshot byte-size, publication latency, and publication-failure
  metrics;
- an incident log for injected failures, expected recovery, and observed recovery.

The run passes only when public p95 is below 250 ms, critical queue p95 is below two seconds,
transactional queue p95 is below ten seconds, snapshot publication p95 is below 60 seconds,
critical delivery remains uninterrupted, campaign resume is crash-safe, Retry-After behavior is
correct, there are no duplicate lifecycle deliveries, and no false-green or privacy leak occurs.

If an acceptance item lacks evidence, label the release **not certified**. The implementation is
still safe to deploy within the demonstrated envelope; it must not be advertised as 1M-subscriber
or 5,000-RPS certified without this record.
