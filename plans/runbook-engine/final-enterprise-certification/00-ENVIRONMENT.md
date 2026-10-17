# OpsKnight Runbook Engine — Phase 0: Test Environment Baseline

## 1. Commit and Branch Baseline

- **Branch**: `feat/runbook-final-enterprise-certification`
- **Parent Branch**: `main`
- **PR #889 Merge Commit**: `7b9aad979`
- **PR #889 Merge Timestamp**: `2026-10-17T12:26:07Z`
- **PR #889 Title**: `fix(runbooks): incident auto-refresh & timeline redesign, workflow builder step details, and E2E certification (#889)`
- **Working Tree Cleanliness**: `git status -s` verified clean.

---

## 2. Server Candidate & Runtime Versions

- **Target Candidate Deployment URL**: `https://opssentinal.com`
- **Candidate Application Version**: `v2.0.0`
- **Local Dev Runtime Verification URL**: `http://localhost:3000/api/health` (HTTP 200 OK)
- **Node.js Engine**: `v22.23.2`
- **npm Version**: `10.9.8`
- **Database Engine**: PostgreSQL 16 (Port `55432` / local development PostgreSQL instance)
- **Database Schema Migration State**: `226 migrations found in prisma/migrations`, verified up to date (`20261016150000_runbook_verification_revision`).
- **Signing Keys Configured**: Active Ed25519 / HMAC keying via `ENCRYPTION_KEY` and `NEXTAUTH_SECRET`.

---

## 3. Container Images & Digests

| Component                   | Repository / Tag                              | Digest / Image ID                                                         |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Target Control Plane Node   | `kindest/node:v1.37.0`                        | `sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5` |
| Native Agent Image          | `opsknight-agent:local` / `pr844-healthcheck` | `sha256:f57192ae1f834044c891e40c97655a875b76d20d538c60f99f480268a608d3ee` |
| OpsKnight Production Image  | `ghcr.io/opsknight-labs/opsknight:2.0.0`      | `sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62` |
| Target Test Podman Runtime  | Podman inside Kind node                       | `5.4.2` (Rootless)                                                        |
| Target Test Systemd Runtime | Systemd PID 1 inside Kind node                | `systemd 255 (255.4-1ubuntu8.4)`                                          |

---

## 4. Agent Topology & Compatibility

- **Protocol Version**: Native OpsKnight Runbook Protocol v2 (TLS 1.3 / WebSocket mutual auth via ephemeral token & HMAC-signed lease negotiation).
- **Supported Capabilities Declared**:
  - `BASH` (Native POSIX command execution)
  - `DOCKER` / `DOCKER RUNTIME` (Container lifecycle, exec, inspect, restart)
  - `KUBERNETES` (Namespace scoping, deployment rollouts, pod restarts)
  - `SYSTEMD` (Unit status inspection, reload, restart, journalctl logs)
  - `PODMAN` (Rootless and root container management)
  - `HTTP` (Synthetic probe checks and webhooks)
- **Fleet Verification**:
  - `docker-host-agent` (ID: `9c30a68ed4c9`): ONLINE, reported capabilities: `DOCKER RUNTIME`, `DOCKER`, `BASH`, `LINUX DIAGNOSTICS`.
  - `linux-native-host-agent` (ID: `opsknight-cluster-control-plane`): ONLINE, reported capabilities: `PODMAN`, `SYSTEMD`, `DOCKER`, `BASH`.

---

## 5. Health Center Status

- **URL**: `https://opssentinal.com/runbooks/health`
- **Execution Plane**: Local worker `Running`
- **Worker Lane**: `all`
- **Health Snapshot**:
  - Active Executions: `0` in-flight
  - Queue Pending: `0`
  - Healthy Fleet: 4 active connected agents reporting stable heartbeats
  - Control Plane State: Certified healthy

---

## 6. Isolation Confirmation

- **Infrastructure Isolation**: All target workloads (`cert3-*`) are isolated inside dedicated Docker network bridges and disposable Kind namespaces (`opsknight-cert3`).
- **No Production Traffic Impact**: No customer traffic or production routing rules share tenant namespace with the certification lab.
- **Rollback Points**: Pre-test container states and snapshots recorded.
