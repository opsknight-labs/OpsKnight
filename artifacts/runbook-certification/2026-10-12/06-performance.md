# OpsKnight Runbooks Certification — 06. Performance, Latency & Resource Budgets

**Audit Date:** 2026-10-12  
**Commit:** `ea38c8c5601189225e3c5edd1efeed855c034c7d`  

---

## 1. Test Suite Execution & Verification Latencies

The test suite was executed on Apple Silicon (macOS arm64) against local PostgreSQL 15.19:

| Test Suite / Operation | Test Files | Total Tests | Duration | Latency / Test | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **CI Change Gate Classification** | 1 | 6 | 0.04s | 7.4 ms | PASSED |
| **Documentation & Parity Lint** | 1 | 322 docs | 1.80s | 5.6 ms/doc | PASSED |
| **TypeScript Full Typecheck** | All src | N/A | 3.12s | Entire repo | PASSED |
| **Runbook Release Vitest Gates** | 28 | 334 | 33.15s | 99.2 ms | PASSED |
| **RBAC & Page Guards** | 3 | 66 | 1.87s | 28.3 ms | PASSED |
| **Runbook API, Metrics, Registry** | 5 | 25 | 4.44s | 177.6 ms | PASSED |
| **Real DB Execution & Lifecycle** | 3 | 108 | 135.45s | 1.25 s (DB commits) | PASSED |
| **Real DB Encryption Migration** | 1 | 7 | 11.93s | 1.70 s (Key rotation) | PASSED |
| **Total Automated Coverage** | **42** | **546** | **191.80s (~3.2 min)** | **Average: 351 ms** | **PASSED** |

---

## 2. Orchestration & Cryptographic Performance

### 2.1 Plan Digest & Checksum Generation
- **SHA-256 Canonical JSON Serialization:** Benchmarked at `< 1.5 ms` per 20-step runbook definition.
- **Zero Allocations for Unchanged Graphs:** Checksums are cached alongside definition versions, avoiding redundant hashing during repeated polling.

### 2.2 Asymmetric Envelope Cryptography
- **Ed25519 Signing (Control Plane):** `< 0.3 ms` per attempt envelope.
- **Ed25519 Verification (Agent):** `< 0.4 ms` per received envelope.
- Extremely low CPU impact even during concurrent step dispatches across dozens of agents.

---

## 3. Buffer Limits & Memory Safety Budgets

To prevent memory leaks, buffer overflows, or database bloat, the Agent and orchestrator enforce hard bounds:

| Boundary | Enforcement Point | Hard Limit | Invariant Handled |
| :--- | :--- | :--- | :--- |
| **Step Output Size** | `agent/src/executor.ts` (`sliceUtf8Safe`) | 262,144 bytes (256 KB) | Truncates stdout/stderr safely at valid UTF-8 character boundaries |
| **Log Tail Depth** | `agent/src/executor.ts` | 500 lines | Limits `journalctl`, `docker logs`, and `kubectl logs` tail parameters |
| **Kubernetes Limit Bytes** | `agent/src/executor.ts` | 262,144 bytes | Enforces `--limit-bytes=262144` on `kubectl logs` |
| **Spool Disk Directory** | `agent/src/spool.ts` | 50 MB / FIFO prune | Prevents disk full conditions on disconnected hosts |
| **Execution Deadlines** | `src/lib/runbooks/orchestrator.ts` | Configurable (Default 1 hr) | Enforces hard cancellation on stalled executions |

---

## 4. Kubernetes Workload Provisioning & Reaction Latency

Benchmarked on Kind v1.37.0 on macOS:
- Kind cluster initialization: **16 seconds**
- Test workload deployment (`nginx:stable-alpine`): **1.2 seconds**
- Pod readiness & rollout status completion: **18 seconds**
- Kubernetes step inspection (`kubectl get deployment cert-web`): **< 80 ms**
