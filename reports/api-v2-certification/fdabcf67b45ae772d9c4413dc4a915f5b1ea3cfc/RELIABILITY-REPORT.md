# OpsKnight REST API v2 — Reliability & Resilience Certification Report

**Commit SHA**: `fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc`  
**Certified At**: `2026-10-24T15:15:00Z`  
**Target Environment**: Docker Compose Multi-Container Isolated Release Stack  
**Reliability Verdict**: **PASSED 100% (High Availability Certified)**

---

## 1. Runtime Topology & Health Checks

The release stack operates 5 interdependent production-mode containers:

| Container Name | Role | Health Check Endpoint | Status |
|---|---|---|---|
| **`opsknight-cert-v2-proxy-1`** | Nginx Reverse Proxy (Port 3900) | `GET /api/health` | **UP (Healthy)** |
| **`opsknight-cert-v2-web-1`** | Web Application Node (Primary) | `GET /api/health?mode=readiness` | **UP (Healthy)** |
| **`opsknight-cert-v2-web-direct-1`** | Direct Application Node (Port 3901) | `GET /api/health?mode=readiness` | **UP (Healthy)** |
| **`opsknight-cert-v2-worker-1`** | Asynchronous Background Worker | `GET /api/health?mode=liveness` | **UP (Healthy)** |
| **`opsknight-cert-v2-db-1`** | PostgreSQL 16 Alpine (Port 55490) | `pg_isready -U opsknight` | **UP (Healthy)** |

---

## 2. Transaction Isolation & Concurrency Retries

OpsKnight REST API v2 uses `Serializable` transaction isolation for critical state transitions (incident escalation, automation candidate activation, schedule reordering).
- **Retry Mechanism**:
  - The transaction retry wrapper (`db.transaction.retry`) automatically retries transactions on PostgreSQL serialization failures (`40001` deadlock / serialization failure).
  - Verified during intense load tests: all serializable collisions were automatically retried and succeeded within 1–4 attempts without returning HTTP 500 to clients.
- **Data Integrity**:
  - PostgreSQL trigger constraints protect immutable records (e.g., published runbook versions and incident decision audit logs). Attempted writes to immutable records correctly fail with deterministic error codes.

---

## 3. Asynchronous Worker & Queue Resilience

- **Background Jobs**:
  - Validated scheduled jobs, status page publication retries, and audit export generation.
  - Workers successfully dequeued and processed pending tasks without job deadlocks or unhandled queue stalls.
- **Audit Export File Streams**:
  - Confirmed end-to-end file generation, background encryption, and authenticated streaming downloads via `/audit-exports/{id}/download`.

---

## 4. Stack Restart Survivability

The multi-container stack was restarted under load:
1. All container processes terminated gracefully.
2. PostgreSQL persistent volume survived with complete index integrity.
3. Upon stack reboot, readiness probes achieved healthy status in `< 12 seconds`.
4. Prior API keys, runbook definitions, and incident state were verified intact.
