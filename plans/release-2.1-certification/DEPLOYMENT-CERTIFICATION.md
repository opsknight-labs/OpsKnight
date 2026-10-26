# OpsKnight 2.1 — Deployment Topologies & Infrastructure Certification

**Candidate Commit SHA:** `abede9203d257fafeff8c4d19ef23dc269bc8274`  
**Certification Status:** APPROVED  
**Verification Date:** 2026-10-26  
**Auditor:** Infrastructure & Release Engineering Architecture

---

## 1. Supported Deployment Topologies Matrix

| Topology                            | Target Scale                | Components                                          | Migration Mode                       | Health / Readiness              | Status             |
| ----------------------------------- | --------------------------- | --------------------------------------------------- | ------------------------------------ | ------------------------------- | ------------------ |
| **1. Docker Compose (Integrated)**  | Single-node / Small team    | Web, Worker, PostgreSQL bundled                     | Entrypoint automatic migration       | `/api/health?mode=readiness`    | **Supported (GA)** |
| **2. Docker Compose (Split)**       | Mid-scale / Multi-container | Nginx Reverse Proxy, 2x Web, 1x Worker, External PG | Dedicated Migration Task             | HTTP 200 on proxy `:3900`       | **Supported (GA)** |
| **3. Docker Swarm (Enterprise HA)** | High-availability cluster   | Swarm services, Overlay network, Secrets, PgBouncer | Dedicated one-shot migration service | Swarm service health checks     | **Supported (GA)** |
| **4. Kubernetes / Helm Chart**      | Cloud-native production     | Helm chart, Ingress, Pod autoscaling, CronJobs      | Pre-upgrade Helm Hook Job            | K8s liveness & readiness probes | **Supported (GA)** |

---

## 2. Topology Deployment Verification Details

### 2.1 Docker Compose (Split Runtime Certification)

- Verified with `tests/certification/docker-compose.release-cert.yml`:
  - `db`: PostgreSQL 16 Alpine with persistent volume `opsknight_cert_v2_pgdata`.
  - `migration`: One-off migration container (`OPSKNIGHT_MIGRATION_ONLY: 'true'`) connecting via `DIRECT_DATABASE_URL`.
  - `web`: 2 scaled web replicas load-balanced by Nginx (`proxy:3000`).
  - `worker`: Dedicated background worker (`OPSKNIGHT_PROCESS_ROLE: worker`) for notification delivery and runbook scheduling.
- **Result:** Successfully converged and certified.

### 2.2 Docker Swarm (Stack Certification)

- Validated with `deploy/swarm/docker-stack.yml` and `deploy/swarm/docker-stack.db.yml`:
  - Utilizes Docker Secrets (`opsknight_db_password`, `opsknight_encryption_key`) rather than plaintext environment variables.
  - PgBouncer transaction-pooling service routes application queries while direct DB network link routes schema migrations.
- **Result:** Manifests and convergence verified.

### 2.3 Kubernetes & Helm

- Validated with `deploy/kubernetes/helm/opsknight`:
  - Helm templates parse cleanly without lint errors (`helm lint`).
  - Pre-install / pre-upgrade migration hook job ensures schema updates commit before new web/worker pods receive traffic.
- **Result:** Manifests and migration hook lifecycle verified.
