# Ingestion certification ledger

Date: 2026-10-23. Candidate branch: `feat/enterprise-event-ingestion`.

Enterprise status: **NOT CERTIFIED. No PR is authorized by this ledger.** The six-phase architecture plan is not complete; see `implementation.md` for the remaining transport, fairness, storage and deployment work.

## Executed local evidence

- Node 20.20.2, matching the repository's supported major version.
- Fresh PostgreSQL 16 migration deployment succeeded in an isolated localhost Docker database. No existing application or SCIM database was modified.
- Prisma schema validation passed. The repository migration scanner reported no errors and 48 warnings in historical migrations; neither new ingestion migration generated a warning.
- PostgreSQL ingestion tests: 21 passed. Includes SIGKILL before incident transaction commit, expired-lease recovery, stale-owner fencing, concurrent duplicate admission, hot-key drain, full rollback, unknown-version DLQ, FIFO blocking/replay, bounded capacity, retention, original-time recovery semantics, pinned LIVE Automation versions and the live emergency-disable switch.
- Focused API/runtime tests: 16 passed, including admin RBAC, scoped receipt access, no raw payload/lease selection, strict operator commands and shared-quota unavailability returning 503 with Retry-After.
- Complete unit suite: 933 files passed; 9,833 tests passed and four existing cases skipped. The skipped cases are not credited as passed certification tests. Focused compatibility checks also passed after the last middleware changes.
- Existing Service Automation certification/concurrency suites: 43 passed; one existing infrastructure restart case skipped because `AUTOMATION_INFRA_DB_RESTART` was not enabled. This skipped case remains a certification gap.
- Production Next.js build passed. Existing middleware deprecation/Edge dependency warnings were reported. The final production build, including the new receipt route, passed. TypeScript and modified-source ESLint checks passed with zero errors and zero lint warnings.
- Compose base + split + ingestion overlay configuration validation passed. No live Compose/Swarm/Helm/Kustomize topology is certified by that parse check.

`local-microbenchmark.json` records 200-event, concurrency-four library workloads with 10 KB custom details, including a synchronous baseline, many-key inbox workload and hot-key workload. Every run reconciled accepted processing, raw alert count, incident count and empty backlog. The load generator stopped admission before drain verification.

The benchmark excludes HTTP, authentication, quota admission, network load balancers, Automation-enabled throughput, external notification delivery and HA failover. It ran on a shared local workstation while other validation work was active. Results are diagnostics, not a sustainable capacity envelope. Acceptance RPS must not be presented as completed-processing RPS.

## Reproduce

Use a dedicated test PostgreSQL database whose name starts with `ingestion_test` on localhost. The ingestion harness refuses other database names/hosts. Populate `DATABASE_URL` with that database's connection string; never point these reset-capable tests at production or a shared development database.

```sh
npx prisma generate
npx prisma migrate deploy
npm run certify:ingestion:db
npm run certify:ingestion:unit
npm run benchmark:ingestion -- plans/event-ingestion/local-microbenchmark.json
npx tsc --noEmit
npm run build
```

The broader existing Automation tests must use a *separate* isolated database because their shared reset helper truncates application tables, including the ingestion reservation seed rows:

```sh
VITEST_USE_REAL_DB=1 npx vitest run --no-file-parallelism --maxWorkers=1 \
  tests/integration/automation-certification.test.ts \
  tests/integration/automation-concurrency.test.ts
```

## Required before enterprise certification

1. Complete Kafka-compatible transport and its replication/offset/rebalance contracts.
2. Complete service/tenant fairness, sustained/burst quotas, critical capacity reservation and high-volume storage lifecycle work.
3. Execute authenticated HTTP and browser workflows; reconcile each accepted receipt and every intended incident transition/outbox effect.
4. Execute database outage/restart, broker failover, worker/host termination, provider 429/503, restore, replay, rolling upgrade and drain scenarios against isolated HA topologies.
5. Run sustained 1,000 RPS, 5,000 RPS for 60 minutes, the 10,000 RPS candidate, 25,000 RPS for 60 seconds with drain, and a 24-hour soak. Record acknowledgements and completed processing separately, rejected requests, backlog/oldest age, p50/p95/p99 latency, database/WAL/lock pressure, retries and correctness failures.
6. Publish topology-specific measured limits, workload definitions and rollback evidence. A failed target is a failed certification, not an adjusted success definition.

The available Kubernetes context was `kind-opsknight-cluster`, but its API endpoint refused connection during inspection. Docker reported a 12-CPU, 8 GiB VM shared with existing services. No dedicated enterprise certification deployment or load generator was available in this session.

## Image upgrade compatibility follow-up

Populated upgrade checks passed from published v2.0.0 and the ingestion branch's original main base. Both checks run the actual image migration entrypoint twice, preserve existing data, exercise the legacy Events API and verify old Prisma client reads/writes after upgrade. See `image-upgrade-compatibility.md` and the two `upgrade-*.json` evidence files. These are startup-script and handler checks, not a running-container rolling-image certification.

The follow-up ingestion suite passed 24 tests; focused runtime/API/side-effect regression tests passed 57 tests. TypeScript, modified-file lint and the production build passed. Default synchronous mode retains its previous payload limits, ignored idempotency-header behavior, timestamps and incident-bearing response. Ingestion consumers start only after explicit asynchronous activation.

The dedicated local PostgreSQL forced-stop/restart drill also passed: 20 receipts accepted before termination survived; admission during unavailability rejected; one new receipt accepted after recovery; all 21 completed with 21 alerts, 21 incidents and zero pending work. Repeated delivery IDs did not duplicate processing. Lease expiry was explicitly advanced after restart; this validates recovery correctness, not natural lease-expiry latency or replicated failover. Evidence: `local-database-outage.json`. Only `opsknight-ingestion-cert-db` was stopped.

## Deep-review remediation candidate (unreleased)

The review of `e6357c5b6` correctly keeps this branch out of release. Follow-up changes address canonical/legacy ordering, abandoned-lease retry limits, held payload preservation, audited dead-letter disposition, direct ingestion-worker connection accounting, credential filtering, and integration-scoped receipt inspection/response propagation. Dedicated Bugbot/Security Review tooling was unavailable; independent review agents were used and their concrete findings were fixed. One subsequent Bugbot verification attempt failed because its selected model was at capacity; do not treat that attempt as a clean review.

The initial authenticated production HTTP diagnostic targeted 20 RPS for 10 seconds. All 198 acknowledged receipts completed with 198 alerts/incidents and no pending events, but latency and dropped-iteration thresholds failed. The worker used the subsequently corrected credential scanner, whose plain-string processing was too expensive. The failed evidence remains in `local-http-smoke.json`; it is not a passing capacity result or evidence of sustainable throughput.

Provider shared-batch payload storage/atomic admission, operational timing/SLA product semantics, independently scalable storage lifecycle, critical capacity reservation, dynamic System settings, every-provider HTTP certification, sustainable target throughput and enterprise HA remain open. The original plan is not fully covered.


The follow-up local HTTP diagnostic after credential-scan correction passed its configured 20 RPS / 10 second target: 201 acknowledged receipts reconciled to 201 completed receipts, alerts and incidents, no unfinished work, and p95 admission latency about 54 ms. See `local-http-smoke-after-review.json`. Its target is diagnostic only and Automation/notification delivery were not representative enterprise workloads.

The next candidate adds shared atomic batch admission and separate receipt clocks. Its isolated database/contract suite passed 37 tests, including a 320+ KiB Prometheus webhook, child-context reconstruction, duplicate reconciliation, older receipt reuse, late capacity rollback, corrupted shared context, hold creation after child pruning, concurrent hold creation, and a two-hour processing delay. Focused API/privacy/credential tests passed 20 tests. These counts overlap earlier suites and must not be added to historical totals.


Production HTTP checks passed for Prometheus (329,362-byte, 40-child webhook), Grafana (two-child signed webhook, including invalid-signature rejection), Datadog (two-child batch), and the generic webhook. Each checks invalid credentials, duplicate request reconciliation, receipt propagation and authorized inspection, request-size rejection, and complete receipt/alert/incident reconciliation. Cross-integration inspection is checked after the first fixture. Evidence: `local-provider-http.json`, including the running build ID and dirty-source flag. These checks are not provider-wide certification and do not claim exact-commit certification.


The short 1,000 RPS diagnostic **failed** its target. It acknowledged 2,401 events, all of which reconciled to completed receipts, alerts and incidents with zero unfinished work or ambiguous acknowledgements. Measured acknowledgement throughput was about 218 RPS including harness completion; processing including drain was about 39 RPS. Latency and dropped-arrival thresholds failed. See `local-http-1000-rps.json`. This workload still excludes representative Automation/notification delivery and does not establish sustainable capacity. Do not expand to enterprise acceptance claims from a fully reconciled but overloaded run.


A separate profiled 100 RPS / 10-second diagnostic passed admission, reconciliation and the new two-second completion-p95 threshold: 1,001 accepted/completed events, completion p95 474 ms, and four events still processing at admission end before full drain. PostgreSQL recorded about 44,354 query calls and 2.68 aggregate seconds of server execution, with no observed deadlocks or temporary spill. Sampled transactions often waited for the client. These observations suggest investigating query round trips/client scheduling and topology as well as database execution; they do not establish causation or enterprise capacity. Evidence: `local-http-profile-100-rps.json`. The repeated-string synthetic payload is highly compressible, and this run has no representative Automation or notification delivery.

The metrics follow-up passed 29 metrics/registry tests, 37 database/contract tests, nine CI-classification tests, source lint/type checking and a production build. Prometheus 3.15.0 validates all 21 rules and passes both ingestion and existing maintenance rule tests. Independent review found and corrected a mixed-rollout alert masking bug: evidence failures now match the enabled target, preserving deployment labels.


The first official Dockerfile build was deliberately capped at a 3 GiB Node heap and failed with V8 heap exhaustion during compilation. This is a failed build attempt, not image compatibility evidence. The Dockerfile's default 4 GiB build is the next check. The subsequent readiness follow-up passed 16 role/health tests and source type/lint checks; image execution and natural worker lease recovery remain unverified until the managed topology harness runs.

The default 4 GiB Docker build also failed: its compiler was terminated by SIGKILL and BuildKit reported `cannot allocate memory` in the shared 8 GiB VM. Neither attempt produced a candidate image. The build follow-up enables Next.js's documented webpack memory optimizations and explicitly enables its compilation worker, which the custom PWA webpack wrapper otherwise disables. Type checking, explicit lint of the configuration, and nine runtime-role/worker-health tests pass. Production image execution is still pending; no runtime or capacity result is credited to this build change.
