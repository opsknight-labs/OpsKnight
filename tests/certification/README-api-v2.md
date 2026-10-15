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

Local runs on one macOS host (Docker Desktop VM, shared with other workloads), image built from the
branch, PostgreSQL 16, nginx overwriting `X-Forwarded-For`. 24 API keys used round-robin. These are
laptop numbers, not capacity claims. Raw k6 summaries are in `results/api-v2/`.

| Date | Topology | Scenario | Result |
|---|---|---|---|
| 2026-10-15 | proxy, 2 web replicas | `valid_reads` 100 rps | PASS: p95 9.5 ms, p99 < 25 ms, 0 server errors |
| 2026-10-15 | proxy, 2 web replicas | `idempotent_writes` (100 keys x 4 concurrent) | PASS: 89 teams for 89 distinct keys, 0 duplicates, 0 server errors |
| 2026-10-15 | proxy, 2 web replicas | `mixed_mutations` (two writers, same ETag) | PASS: 473 iterations, exactly 473 updates, 473 deletes; audit rows match mutation counts (562 created = 89 + 473, 473 updated, 473 deleted) |
| 2026-10-15 | proxy, 2 web replicas | `invalid_flood` 300 rps + valid probe 24 rps, same address (NAT case) | **FAIL**: 0 server errors and 0 valid clients rejected with 401/403, but 60.4% of valid probe requests received an authentication-admission 429 (threshold 5%); probe p95 about 4 s. Measured before the priority lane below |
| 2026-10-15 | direct, 1 web replica | `unknown_ip` 200 rps + valid probe 24 rps | **FAIL**: 57.3% admission 429 for the valid probe (threshold 5%), p95 about 1 s. Measured before the priority lane |

### Open: re-measure after the priority admission lane

The failing flood runs motivated a priority lane for credentials that recently verified on a replica
(`API_V2_PRIORITY_AUTH_CONCURRENCY`). The database still decides every request, so revocation stays
immediate, and an unknown token can never use the lane. It is unit-tested (valid credential passes a
saturated flood allowance; revoked credential is rejected and loses its hint; unknown tokens never
enter it). **It has not been re-measured**: rebuilding the image stalled because the Docker VM was
saturated by other workloads. Re-run `invalid_flood` (proxy) and `unknown_ip` (direct) and update the
two rows above. A client whose credential has not yet verified on a given replica still shares the
throttled lane, so first-contact requests during an attack can see 429s.

### Not run

1 and 4 replica sweeps, replica kill during `idempotent_writes`, rolling upgrade, `pg_stat_activity`
connection growth during a flood, and the Kubernetes ingress topology.
