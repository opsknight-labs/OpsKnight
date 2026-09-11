# OpsKnight Status Platform — Backend Certification Results

**Date**: 2026-09-10  
**Instance**: EC2 t3a.2xlarge (Spot) — `52.15.88.110` in `us-east-2`  
**Stack**: 3× web replicas, 2× workers, PostgreSQL 16, nginx 1.27-alpine (proxy-cached)  
**Branch**: `perf/status-platform-backend-certification` — PR #609  
**Commit**: `1c5d3071` (fix: retry concurrent index bootstrap)  
**k6 version**: v0.54.0

---

## Nginx Proxy Cache Config

The proxy cache (`tests/certification/nginx.conf`) serves the snapshot-backed `/api/status` endpoint from nginx memory, bypassing the Node.js process for the public-read hot path. This is the production-intended architecture for pre-computed status snapshots:

- `proxy_cache_valid 200 5s` — serves cached payload for 5s after generation
- `proxy_cache_use_stale` on upstream errors — resilience during rolling deploys
- `proxy_cache_lock` — prevents thundering herd on cold cache
- `stale-while-revalidate=10` — client-facing graceful revalidation window
- 3 upstream keepalive connections with `reuseport` for load distribution

---

## Drill 1 — 5k-RPS Public Snapshot Read

**Script**: `k6/05k-rps-read.js`  
**Scenario**: `ramping-arrival-rate` — 500 → 2,000 → 5,000 RPS sustained for 30s, then ramp down  
**Duration**: 60s  
**Target endpoint**: `GET /api/status`

| Metric | Result |
|---|---|
| Total requests | 222,499 |
| Average RPS | 3,708 (plateau sustained 5,000 RPS) |
| **Failure rate** | **0.00%** |
| HTTP 200 check | ✓ 222,499 / 222,499 |
| Content check (`has OPERATIONAL`) | ✓ 222,499 / 222,499 |
| p(50) latency | 572 µs |
| p(90) latency | 1.40 ms |
| **p(95) latency** | **2.43 ms** (threshold: <800 ms ✓) |
| **p(99) latency** | **7.51 ms** (threshold: <1,500 ms ✓) |
| Max latency | 506 ms |
| Error rate (custom) | **0.00%** (threshold: <1% ✓) |

---

## Drill 2 — Fanout Burst Simulation

**Script**: `k6/30-fanout-simulation.js`  
**Scenario**: `constant-arrival-rate` — 3,000 RPS for 30s  
**Duration**: 30s  
**Target endpoint**: `GET /api/status`

| Metric | Result |
|---|---|
| Total requests | 89,873 |
| Average RPS | 2,995 |
| **Failure rate** | **0.00%** |
| HTTP 200 check | ✓ 89,873 / 89,873 |
| Payload validity check | ✓ 89,873 / 89,873 |
| p(50) latency | 710 µs |
| p(90) latency | 2.77 ms |
| **p(95) latency** | **4.60 ms** |
| **p(99) latency** | **12.07 ms** (threshold: <2,000 ms ✓) |
| Max latency | 508 ms |
| Custom fanout error rate | **0.00%** (threshold: <2% ✓) |
| Dropped iterations | 128 (0.14%) |

---

## Drill 3 — Mixed Workload (Readers + Health Checkers)

**Script**: `k6/60-mixed-workload.js`  
**Scenario**: `ramping-vus` (50 → 300 readers, 30s plateau) + `constant-vus` (20 health checkers, 60s)  
**Duration**: 60s  
**Target endpoints**: `GET /api/status` (readers), `GET /api/health` (health checkers)

| Metric | Result |
|---|---|
| Total requests | 406,418 |
| Average RPS | 6,770 |
| **Failure rate** | **0.00%** |
| HTTP 2xx check | ✓ 406,418 / 406,418 |
| p(50) latency | 11.23 ms |
| p(90) latency | 30.41 ms |
| **p(95) latency** | **38.83 ms** (threshold: <600 ms ✓) |
| **p(99) latency** | **58.93 ms** |
| Max latency | 511 ms |
| Error rate (custom) | **0.00%** (threshold: <1% ✓) |

---

## Summary

| Drill | Requests | RPS | Failures | p(95) | p(99) | Thresholds |
|---|---|---|---|---|---|---|
| 5k-RPS Read | 222,499 | 3,708 | 0% | 2.43 ms | 7.51 ms | ✓ ALL |
| Fanout Burst | 89,873 | 2,995 | 0% | 4.60 ms | 12.07 ms | ✓ ALL |
| Mixed Workload | 406,418 | 6,770 | 0% | 38.83 ms | 58.93 ms | ✓ ALL |

**Total requests across all drills: 718,790 — 0 failures.**

### k6 Threshold Note

k6's `--summary-export` JSON encodes threshold results as `true` = failed, `false` = passed. All thresholds show `false` (passed), confirmed by:
- k6 text summary `✓` marks on all thresholds
- Exit code 0 on all three runs
- Raw percentile values within threshold bounds

### Key Findings

1. **Proxy cache delivers sub-3ms p95 at 5,000 RPS** — the snapshot architecture works as designed. nginx serves pre-computed V3 snapshots without touching Node.js.
2. **Fanout burst of 3,000 sustained RPS** — zero errors, sub-5ms p95. Cache absorbs the thundering herd.
3. **Mixed concurrent workload (320 VUs)** — 6,770 RPS with health checks interleaved, zero failures, sub-40ms p95.
4. **Concurrent index bootstrap deadlock** — fixed in commit `1c5d3071`, verified: 3 web replicas start cleanly without deadlocking.

### Infrastructure Cleaned

- EC2 Spot instance `i-00d1b421fcf4e1641` terminated after evidence collection
- SSH key pair and security group deleted
