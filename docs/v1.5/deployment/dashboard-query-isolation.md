# Dashboard query isolation

The dashboard renders current operational state from bounded counts, grouped rows, and limited incident lists. Historical SLA analytics load independently through a private, server-authorized endpoint. A slow analytics query therefore cannot block incident response or the initial dashboard render.

## Database rollout

Apply migrations before deploying the application. The additive migration captures pause-adjusted ACK and resolve durations for existing incidents; older application versions safely ignore these columns. Do not drop the columns during rollback.

After migration, sample `slaAckElapsedMs` and `slaResolveElapsedMs` against `IncidentSlaPause` history before deploying broadly. Late lifecycle changes continue to use the existing rollup reconciliation path.

## Connection sizing

- Small 1-vCPU test database: `DATABASE_POOL_SIZE=5`
- Normal single application: default `10`
- Split web deployment: `10` per web pod
- Split worker deployment: `10` per worker pod
- Scheduler: `5`

An explicit `connection_limit` in `DATABASE_URL` takes precedence. Size aggregate connections across replicas and PgBouncer against the actual PostgreSQL limit.

Application connections default to a 30-second PostgreSQL `statement_timeout`; an explicit `options` parameter in `DATABASE_URL` takes precedence. This bounds an executing query rather than only bounding pool wait time. Validate longer administrative/reporting workloads before lowering the limit.

## Certification

Seed an isolated performance database (never production), or restore a production-shaped fixture:

```sh
PERF_SEED_CONFIRM=1084 DATABASE_URL='postgresql://…/isolated_perf' \
  npx ts-node --project tsconfig.script.json scripts/perf/dashboard-seed.ts
```

The command prints a unique run ID embedded in every fixture title for targeted cleanup. Obtain authenticated cookies for distinct representative global and scoped users, then run:

First certify the exact 1,084-row SLA query directly and retain its JSON result:

```sh
PERF_SERVICE_ID='<serviceId printed by the seed>' DATABASE_URL='postgresql://…/isolated_perf' \
  NODE_PATH=scripts/perf/shims npx ts-node --project tsconfig.script.json \
  -r tsconfig-paths/register scripts/perf/dashboard-benchmark.ts
```

The benchmark executes ten uncached SLA calculations, reports cold/p50/p95/max, and fails when p95 reaches five seconds.

Then certify the authenticated dashboard topology:

```sh
k6 run -e BASE_URL=https://staging.example.com \
  -e SESSION_COOKIES_JSON='["next-auth.session-token=admin…","next-auth.session-token=scoped-user…"]' \
  scripts/load/dashboard-query-isolation.js
```

The script distributes VUs across those identities and fails when analytics admission errors exceed 2%. Record shell and analytics p50/p95/p99, PostgreSQL CPU/load, active connections, slow-query duration, cache state, readiness latency, realtime recovery, analytics calculation count, dashboard RSC requests after one incident mutation, and analytics 503 rate. Targets are shell p95 under 2 seconds, cached analytics under 250 ms, cold analytics under 5 seconds, readiness p95 under 1 second, and analytics 503 below 2%. The operational dashboard must remain usable during admission pressure.

Prometheus exposes dashboard shell/analytics duration, analytics in-flight work, cache states, stale serves, and failures. Deep health exposes cache entry count and last success/failure timestamps without treating stale analytics as an application outage.

The SLA capture migration performs one set-based historical backfill. For very large installations, measure the qualifying incident and pause-row counts, migration duration, WAL capacity, and replica lag on a restored production-sized database before rollout. Schedule the migration in a controlled window when that rehearsal exceeds the normal deployment budget.
