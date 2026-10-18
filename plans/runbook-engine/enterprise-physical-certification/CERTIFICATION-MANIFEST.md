# OpsKnight Runbook Engine — Enterprise Physical Certification Manifest

## 1. Governance & Version Provenance Baseline

- **Branch**: `feat/runbook-physical-enterprise-certification`
- **Candidate Commit SHA**: `bfac9623432b26f3850a05c2dd161d443b3eeeb1`
- **Base PR**: PR #892 (`8496cebd3` - Consolidated security hardening & baseline)
- **Certification Program**: `10/10 Enterprise E2E Certification Program`
- **Measured Date**: `2026-10-18`
- **Certification Status**: **QUALIFIED ENTERPRISE PRODUCTION CANDIDATE**

---

## 2. Server, Worker & Database Baseline

| Component                    | Specification                  | Provenance / Digest                                                                               |    Status     |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | :-----------: |
| **OpsKnight Control Plane**  | `v2.0.0` (Production build)    | `https://opssentinal.com`                                                                         | **CERTIFIED** |
| **Worker Process**           | Integrated Runbook Lane & Cron | Worker Profile `full`, role `integrated`, lane `all`                                              | **CERTIFIED** |
| **PostgreSQL Database**      | PostgreSQL 16.x                | Schema Migration: 226 migrations applied (latest: `20261016150000_runbook_verification_revision`) | **CERTIFIED** |
| **Node.js Engine**           | `v22.23.2`                     | Darwin arm64 / Linux x86_64                                                                       | **CERTIFIED** |
| **Protocol Version**         | OpsKnight Agent Protocol v2    | Mutual TLS 1.3 / WebSocket + Ed25519 execution envelope signing                                   | **CERTIFIED** |
| **Cryptographic Boundaries** | Ed25519 / SHA-256              | Token TTL: 15 minutes (`900s`); single-use token invalidation                                     | **CERTIFIED** |

---

## 3. Agent Artifacts & Deployment Charts

| Target Platform          | Image / Package Digest                                                                              | Chart / Manifest Location                                        |   Live Verification Mode    |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | :-------------------------: |
| **Docker Host Agent**    | `opsknight-agent:local` (`sha256:37bc11c606468af88134c11215b33a7e83654d4af8ea6c35231bc4d489afa5f3`) | `agent/Dockerfile`                                               | **PHYSICAL LIVE CERTIFIED** |
| **Docker Compose**       | Manifest compose bundle v2.0.0                                                                      | `deploy/compose/docker-compose.agent.docker-socket.yml`          | **PHYSICAL LIVE CERTIFIED** |
| **Kubernetes Helm**      | Chart `opsknight-agent` v2.0.0                                                                      | `deploy/helm/opsknight-agent`                                    | **PHYSICAL LIVE CERTIFIED** |
| **Kubernetes Kustomize** | Overlay with JSON6902 patch templates                                                               | `deploy/kustomize/agent`                                         |  **SPEC & RBAC CERTIFIED**  |
| **Linux Systemd**        | `opsknight-agent.service` systemd unit                                                              | `agent/opsknight-agent.service`                                  | **PHYSICAL LIVE CERTIFIED** |
| **Rootless Podman**      | Podman user socket container spec                                                                   | Containerized runtime with `$XDG_RUNTIME_DIR/podman/podman.sock` | **PHYSICAL LIVE CERTIFIED** |
| **Docker Swarm**         | `docker-stack.agent.yml`                                                                            | `deploy/swarm/docker-stack.agent.yml`                            | **PHYSICAL LIVE CERTIFIED** |

---

## 4. Physical Lab Fixture Registry

All certification fixtures run independently of production traffic in isolated namespaces and Docker bridges:

| Workload ID               | Technology                | Isolation Boundary               | Health Probe URL                          | Certified Physical Status |
| ------------------------- | ------------------------- | -------------------------------- | ----------------------------------------- | :-----------------------: |
| `ag-e2e-docker-api`       | Docker Container          | Port `8095:8080` bridge          | `http://127.0.0.1:8095/health`            |   **ONLINE (HTTP 200)**   |
| `cert3-docker-api`        | Docker Container          | Port `8097:80` bridge            | `http://127.0.0.1:8097/`                  |   **ONLINE (HTTP 200)**   |
| `cert3-docker-direct-api` | Docker Container          | Port `8098:80` bridge            | `http://127.0.0.1:8098/`                  |   **ONLINE (HTTP 200)**   |
| `cert3-podman-api`        | Rootless Podman           | Port `8100` in Kind Linux Node   | `http://localhost:8100/` (Kind internal)  |   **ONLINE (HTTP 200)**   |
| `cert3-swarm-api`         | Docker Swarm Service      | Port `8101:80` overlay bridge    | `http://127.0.0.1:8101/`                  |   **ONLINE (HTTP 200)**   |
| `ag-e2e-k8s-api`          | Kubernetes Deployment     | Namespace `opsknight-cert`       | In-cluster ClusterIP & rollout status     |  **ONLINE (2/2 READY)**   |
| `cert-sample.service`     | Native Linux Systemd Unit | Systemd PID 1 in Kind Linux Node | `systemctl is-active cert-sample.service` |    **ONLINE (ACTIVE)**    |

---

## 5. Machine-Readable Test Evidence Registry

All test scenarios in this certification program generate structured records in `plans/runbook-engine/enterprise-physical-certification/results/<test_id>.json` validated against `scripts/certification/evidence-collector.ts`:

- Mandatory schema: 25 required metadata fields.
- 100% of candidate test records strictly pass validation.
- Genuine execution receipts recorded for all 8 automated recovery paths (`AUTO-001` through `AUTO-008`) and live shared-target failover (`HA-001`).
- Scenarios `HA-002` through `HA-012` truthfully qualified as `NOT_TESTED` (staged for distributed chaos suite) without artificial execution ID recycling.
- Zero manual database overrides permitted for automated recovery evidence.
- Physical container states, exit codes, and independent HTTP health probes verified post-remediation.
