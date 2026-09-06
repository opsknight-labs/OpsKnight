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

## Certification

Seed an isolated performance database (never production), or restore a production-shaped fixture:

```sh
PERF_SEED_CONFIRM=1084 DATABASE_URL='postgresql://…/isolated_perf' \
  npx ts-node --project tsconfig.script.json scripts/perf/dashboard-seed.ts
```

The command prints a unique run ID embedded in every fixture title for targeted cleanup. Obtain an authenticated session cookie, then run:

```sh
k6 run -e BASE_URL=https://staging.example.com \
  -e SESSION_COOKIE='next-auth.session-token=…' \
  scripts/load/dashboard-query-isolation.js
```

Record shell and analytics p50/p95/p99, PostgreSQL CPU/load, active connections, slow-query duration, cache state, readiness latency, and realtime recovery. Targets are shell p95 under 2 seconds, cached analytics under 250 ms, cold analytics under 5 seconds, and readiness p95 under 1 second. A `503` from analytics during admission pressure is expected; the operational dashboard must stay usable.

Prometheus exposes dashboard shell/analytics duration, analytics in-flight work, cache states, stale serves, and failures. Deep health exposes cache entry count and last success/failure timestamps without treating stale analytics as an application outage.
