# OpsKnight Runbook Engine — Full Alert-to-Recovery Results

## 1. Overview & Verification Topology

Unattended and approval-gated physical remediation was executed against live workloads under real failure conditions.

**End-to-End Pipeline Certified**:
`Monitoring Alert Event -> Incident Creation -> Service Automation Rule Trigger -> Runbook Binding -> Agent Selection -> Execution -> Physical Mutation -> Independent Verification -> Audit`

---

## 2. Certified Recovery Journey Matrix (AUTO-001 through AUTO-008)

| Test ID      | Failure Injection                     | Service & Rule              | Execution ID                | Agent Assigned                   | Physical Remediation Action                     | Independent Verification                          |  Status  |
| ------------ | ------------------------------------- | --------------------------- | --------------------------- | -------------------------------- | ----------------------------------------------- | ------------------------------------------------- | :------: |
| **AUTO-001** | `docker stop ag-e2e-docker-api`       | Auto Remediation Docker API | `cmvdpapw42taf4qmq7moudh12` | `docker-host-agent`              | `docker start ag-e2e-docker-api`                | `curl :8095/health` -> HTTP 200 `{"status":"ok"}` | **PASS** |
| **AUTO-002** | `docker stop cert3-docker-direct-api` | Direct Docker Auto Recovery | `cmvdsgt9s31if4qmqbx6mcms6` | `docker-host-agent`              | `docker start cert3-docker-direct-api`          | `curl :8098/` -> HTTP 200 Nginx                   | **PASS** |
| **AUTO-003** | Scale k8s deployment to zero replicas | K8s Scale Recovery          | `cmvdpgtum2trk4qmqcsw4jbzr` | `test-cert-agent-ui`             | Scale deployment to 2 replicas & verify rollout | 2/2 pods Ready in `opsknight-cert` namespace      | **PASS** |
| **AUTO-004** | `systemctl stop cert-sample.service`  | Native Systemd Recovery     | `cmvdqqbdu2wyi4qmq7podn4f1` | `linux-native-host-agent`        | `systemctl restart cert-sample.service`         | `systemctl is-active` -> `active` (PID 420623)    | **PASS** |
| **AUTO-005** | `podman stop cert-podman-api`         | Rootless Podman Recovery    | `cmvdpp7jv2ue94qmq9sxnqlrc` | `linux-native-host-agent`        | `podman restart cert-podman-api`                | `podman inspect` -> `running: true`, `Up 53m`     | **PASS** |
| **AUTO-006** | Degrade Swarm replicas to 0/1         | Docker Swarm Lifecycle      | `cmvdshjja31lb4qmqza231w10` | `docker-host-agent`              | Swarm container lifecycle & replica recovery    | `curl :8101/` -> HTTP 200 Nginx                   | **PASS** |
| **AUTO-007** | Non-idempotent restart trigger        | Blast Radius Guard Rule     | `cmvchadqm09584qmqassxvp0s` | `docker-host-agent-ha-secondary` | Pauses at `WAITING_APPROVAL` gate               | Operator UI authorization plan preview sign-off   | **PASS** |
| **AUTO-008** | Duplicate firing alert storm          | Duplicate Alert Rule        | `cmvcf0z5k03gj4qmqyxd9v63s` | `docker-host-agent`              | Deduplicates identical alert fingerprints       | Deduplication verified, no duplicate writes       | **PASS** |

> [!NOTE]
> **AUTO-006 Swarm Execution Scope**: OpsKnight Agent executes Docker container lifecycle and orchestration recovery commands on Swarm nodes within supported step types (`DOCKER` / `COMMAND`), validating container health and replica restoration without claiming native Swarm `docker service update` engine step primitives.

---

## 3. Core Engine Defect Discovered & Root Cause Fix

During unattended recovery qualification for AUTO-001, incoming Prometheus alert webhook ingestion successfully created incidents and persisted outbox events, but failed to queue the background evaluation worker.

- **Defect (P0)**: In `src/lib/event-outbox.ts`, the background task enqueue omitted queuing `RUNBOOK` background job with `kind: 'EVALUATE_TRIGGER'`.
- **Root Cause Fix**: Modified `src/lib/event-outbox.ts` to properly enqueue runbook trigger evaluation tasks immediately upon incident ingestion.
- **Regression Test**: Added `tests/lib/event-outbox-runbook-trigger.test.ts` (all tests passed).
- **Physical Proof**: Verified zero-touch incident-to-execution dispatch in execution `cmvdpapw42taf4qmq7moudh12`.

---

## 4. Systemd Executor Status Code Defect Discovered & Formal Contract Implementation

During AUTO-004 testing, status prechecks on stopped systemd units failed with `COMMAND_FAILED`.

- **Defect (P1)**: In `agent/src/executor.ts`, `systemctl status` returns standard LSB exit code 3 when a service is dead/inactive. The agent treated any non-zero exit code as a fatal command failure. Furthermore, treating exit code 3 as an unconditional success would cause false positives when verifying that a service has become active, and regex name heuristics (`/verify|health/`) caused benign diagnostic queries to fail.
- **Root Cause Fix**: Formalized a typed `expectedState: 'active' | 'inactive' | 'any'` contract across the schema, UI builder, and Agent runtime:
  - Exit code 0 returns `SUCCEEDED`, but if `expectedState: 'inactive'`, fails with `SERVICE_ACTIVE`.
  - Exit code 3 returns `SUCCEEDED` for status queries (`expectedState: 'any'`). If `expectedState: 'active'`, fails with `SERVICE_INACTIVE`.
  - Exit code 4 returns `FAILED` with `errorCode: 'UNIT_NOT_FOUND'`.
  - SystemdActionEditor renders an explicit dropdown for `Expected service state`, eliminating string regex heuristics.
- **Regression Test**: Added test cases in `tests/lib/runbooks/agent-executor.test.ts` (25/25 unit tests passed).
- **Physical Proof**: Deployed updated bundle to `linux-native-host-agent`; verified clean execution `cmvdqqbdu2wyi4qmq7podn4f1`.
