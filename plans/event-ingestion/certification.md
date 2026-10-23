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
