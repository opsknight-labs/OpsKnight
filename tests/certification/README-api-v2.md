# REST v2 certification evidence

`k6/api-v2-load-matrix.js` is the load and failure matrix for the REST v2 API. It is the evidence gate
for the supported topologies. **It has not been run as part of this change** — it needs the
certification image (`docker-compose.yml` in this directory) and k6. Until a run is recorded below,
the multi-replica, load and failover properties are *designed and unit-tested, not measured*.

## Topologies

| Topology | How | Purpose |
|---|---|---|
| 1 replica | `docker compose up` (default) | baseline and direct-deployment behaviour (no proxy trust) |
| 2 replicas | `docker compose up --scale web=2` behind `nginx.conf` | shared failed-auth counters, revocation on every replica |
| 4 replicas | `--scale web=4` | connection-pool pressure, idempotency across replicas |
| Kubernetes | `tests/load/kind-4node-cluster.yaml` | ingress forwarding and `TRUSTED_PROXIES` CIDRs |

For topologies behind nginx set `TRUST_PROXY_HEADERS=true` and make nginx *overwrite*
`X-Forwarded-For`. For the direct topology leave it unset to exercise the unidentified-client path.

## Scenarios and what must hold

| Scenario | Must hold |
|---|---|
| `valid_reads` | p95 < 400 ms, p99 < 1 s, no 5xx |
| `invalid_flood` | flooder gets 401/429 only; a valid client on another address is never rejected |
| `unknown_ip` | no per-address lockout of valid clients; verification concurrency bounded |
| `idempotent_writes` | the same `Idempotency-Key` sent concurrently creates at most one resource |
| `mixed_mutations` | two writers with the same `If-Match` → exactly one 200 and one 412 |

Also verify manually, per topology: revoke a token and confirm it fails on **every** replica
immediately; kill a replica during `idempotent_writes` and confirm no duplicates; watch
`pg_stat_activity` for connection growth during `invalid_flood`. Prometheus series to watch:
`opsknight_api_v2_auth_failures_total`, `opsknight_api_v2_rate_limit_decisions_total`,
`opsknight_api_v2_errors_total`, `opsknight_api_v2_auth_lookup_duration_seconds`,
`opsknight_http_request_duration_seconds{route=~"api_v2\..*"}`.

## Recorded runs

_None yet._ Add one row per topology with date, commit, p95/p99, error rate, peak DB connections.
