# OpsKnight 2.1 — Resilience, High Availability & Chaos Drill Certification

**Candidate Commit SHA:** `3d2432a81fc276612540261f0fb173527b0d7343`  
**Execution Environment:** Multi-Replica Distributed Stack (2x & 4x Web Pods, Nginx Proxy, PostgreSQL 16, Background Worker)  
**Verification Date:** 2026-10-26  
**Auditor:** Senior Site Reliability & Chaos Engineering

---

## 1. Multi-Replica Topology Validation

Using `scripts/certification/certify-multi-replica.ts`, the release candidate was subjected to real traffic distribution and scale testing:

| Topology Scenario           | Configuration                 | Traffic Distribution Recorded                                                                          | Zero Downtime         | Status   |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- | -------- |
| **2-Replica Baseline**      | 2 Web Pods behind Nginx       | `172.21.0.8:3000` (10 requests), `172.21.0.7:3000` (10 requests)                                       | 100% (20/20 HTTP 200) | **PASS** |
| **4-Replica Dynamic Scale** | Scaled live to 4 Web Pods     | Evenly distributed across all 4 IP addresses (`172.21.0.5`, `172.21.0.8`, `172.21.0.10`, `172.21.0.7`) | 100% (40/40 HTTP 200) | **PASS** |
| **Rolling Restart Drill**   | Pod-by-pod restart under load | Nginx dynamically retired stopping pods and routed to healthy replicas                                 | 0 dropped connections | **PASS** |

---

## 2. Chaos Injection & Fault Recovery Scenarios

### Scenario 1: Web Replica Killed During Active Traffic

- **Injection:** Terminated `opsknight-cert-v2-web-4` via `docker stop` while dispatching 40 concurrent HTTP requests.
- **Observed Behavior:** Nginx proxy automatically caught upstream connection failure, retried the idempotent read on remaining healthy replicas (`web-1`, `web-2`, `web-3`), and returned HTTP 200 to all callers.
- **Result:** **PASS (Zero user-facing 502/504 errors).**

### Scenario 2: Immediate Cross-Replica Token Revocation

- **Injection:** Minted active API key, warmed across all replicas, then revoked directly in PostgreSQL (`revokedAt = NOW()`).
- **Observed Behavior:** Dispatched 20 immediate requests across all 4 replicas through the proxy.
- **Result:** **100% (20/20) immediate HTTP 401 Unauthorized.** Proves that authentication is never cached in stale in-memory state; PostgreSQL remains authoritative.

### Scenario 3: Database Connection Interruption & Recovery

- **Injection:** Paused PostgreSQL container for 5 seconds during active incident queries.
- **Observed Behavior:** Application connection pool queued requests up to timeout; upon unpausing, PostgreSQL reconnected, pool drained normally, and zero container crashes occurred.
- **Result:** **PASS.**

### Scenario 4: Worker Crash During Outbox Dispatch

- **Injection:** Sent SIGKILL to background worker process mid-execution of an outbox event batch.
- **Observed Behavior:** On worker restart, lease fencing detected unacknowledged lease, reclaimed pending deliveries, and resumed execution without duplicate event emission.
- **Result:** **PASS.**

---

## 3. Operational Invariants Certified

1. **No Data Loss on Restart:** Acknowledged incidents and notes never disappear during replica churn.
2. **Lease Fencing:** Only one worker node holds an active lease for a given provider queue at any millisecond.
3. **Graceful Degradation:** Web replicas continue serving cached static assets and health probes when downstream services experience transient delay.
