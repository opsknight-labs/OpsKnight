# OpsKnight Runbook Engine — Shared-Target HA & Failover Results

## 1. Overview & Architectural Topology

Enterprise high availability requires genuine execution takeover between multiple independent agents sharing host or network reachability to the same target workloads, orchestrated under an explicit pool mode (`SHARED_TARGET`).

### Lab Infrastructure

- **Agent A (Primary)**: `docker-host-agent` (ID: `cmvbcv9lr02hz14mah9j953nm`, Hostname: `9c30a68ed4c9`), running via standalone Docker container with mounted `/var/run/docker.sock`.
- **Agent B (Secondary)**: `docker-host-agent-ha-secondary` (ID: `cmvdqw3n82xgj4qmqyaz4tk6m`, Hostname: `938c51ae901c`), running via Docker Compose (`deploy/compose/docker-compose.agent.docker-socket.yml`) with shared `/var/run/docker.sock`.
- **Agent Pool**: `E2E Fleet Pool` (ID: `cmvbde37o03hf14malayilfy6`), Mode: `SHARED_TARGET`.
- **Shared Target Workload**: `ag-e2e-docker-api` on port `8095:8080`.

---

## 2. Certified Failover Matrix: Staging Physical vs. Automated Safety Qualification

### 2.1 Physically Certified Failover Matrix (HA-001 through HA-003 on Live Staging Pool)

The following scenarios were **physically executed and certified on the live staging cluster** (`opssentinal.com`) using the multi-agent `E2E Fleet Pool` (`docker-host-agent` on `9c30a68ed4c9` and `docker-host-agent-ha-secondary` on `938c51ae901c`):

| Test ID    | Execution ID                | Scenario / Fault Injected                                 | Primary Agent State          | Secondary Agent State        | Executing Agent                  | Physical Outcome                                                              |  Status  |
| ---------- | --------------------------- | --------------------------------------------------------- | ---------------------------- | ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------- | :------: |
| **HA-001** | `cmvdr7xco2ydw4qmqxxp0jizv` | Both Agents online, hard crash of Agent A before dispatch | Hard Stopped (`docker stop`) | Online                       | `docker-host-agent-ha-secondary` | Target container started (`StartedAt: 11:40:46Z`), `/health` returned 200 OK  | **PASS** |
| **HA-002** | `cmvescqg41wvmd9pahuz028jr` | Agent A offline before dispatch                           | Hard Stopped (`docker stop`) | Online                       | `docker-host-agent-ha-secondary` | Target container started (`StartedAt: 05:00:16Z`), `/health` returned 200 OK  | **PASS** |
| **HA-003** | `cmvesgk6c1x92d9pa3jktzn77` | Agent B offline before dispatch                           | Online                       | Hard Stopped (`docker stop`) | `docker-host-agent`              | Target container started (`StartedAt: 05:03:15Z`), `/health` returned 200 OK  | **PASS** |

> [!IMPORTANT]
> **Physical Staging Certification Evidence**: HA-001, HA-002, and HA-003 have complete end-to-end physical receipts showing agent container shutdown (`docker stop`), survivor claim, physical Docker daemon container startup, and external HTTP 200 probe verification on port 8095.

---

### 2.2 Automated Safety & Fault-Injection Qualification (HA-004 through HA-012)

Scenarios HA-004 through HA-012 test mid-mutation failures, stale lease fencing, capability filters, and database claim contention. These behaviors are **fully qualified and verified in automated integration and safety testbeds**, with physical staging crash injection designated for Phase 2:

| Test ID    | Automated Verification Suite                     | Scenario / Fault Injected                                 | Safety Mechanism                                           | Verified Engine Behavior                                                                                 | Status |
| ---------- | ------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | :----: |
| **HA-004** | `tests/integration/runbook-agent-runtime.test.ts` | Agent A fails immediately after claim, pre-mutation       | 300s Lease Expiry Watchdog (`reconciler.ts`)               | Lease expires; attempt marked `UNKNOWN`; re-assigned to surviving agent without duplicate writes         | **QUALIFIED** |
| **HA-005** | `tests/integration/runbook-execution-safety.test.ts` | Agent A fails during physical write                       | Quarantine Fencing (`UNKNOWN_OUTCOME`)                     | Non-idempotent write quarantined; blind retry blocked; operator verification required                   | **QUALIFIED** |
| **HA-006** | `tests/integration/runbook-agent-runtime.test.ts` | Agent A finishes write, crashes before reporting          | Re-verification Probe Gate                                 | Next execution or step runs precheck, detects workload already healthy, safely skips destructive write   | **QUALIFIED** |
| **HA-007** | `tests/unit/runbooks/agent_fencing.test.ts`       | Stale lease reconnection after failover                   | Fencing Token Guard (`agent-claims.ts:827`)                | Late completion attempt from revived agent rejected with `409 Conflict: Expired recovery fence`          | **QUALIFIED** |
| **HA-008** | `tests/integration/runbook-agent-pools.test.ts`  | Secondary agent lacks required capabilities               | Agent Capability Matcher (`agent-pool.ts`)                 | Dispatched strictly to agents satisfying capability requirements (`DOCKER`, `KUBERNETES`, `SYSTEMD`)     | **QUALIFIED** |
| **HA-009** | `tests/unit/runbooks/agent-policy.test.ts`        | Local agent policy denies requested action                | Fail-Closed Policy Engine                                  | Execution rejected locally prior to execution; target workload remains completely unmutated             | **QUALIFIED** |
| **HA-010** | `tests/integration/runbook-agent-pools.test.ts`  | Pool membership detached mid-execution                    | Active Lease Retention Contract                            | Executing agent finishes active step under current lease; subsequent steps fail gracefully               | **QUALIFIED** |
| **HA-011** | `tests/integration/runbook-orchestration.test.ts`| Both pool agents offline                                  | Execution Expiration TTL (`DEFAULT_LEASE_DURATION_SECONDS`) | Execution queued up to timeout deadline, transitions cleanly to `TIMED_OUT` without dangling locks       | **QUALIFIED** |
| **HA-012** | `tests/integration/runbook-agent-claims.test.ts`  | Simultaneous poll race across multiple agents             | PostgreSQL `FOR UPDATE SKIP LOCKED`                        | Row-level lock guarantees exactly one agent claims execution attempt; zero dual-execution               | **QUALIFIED** |

> [!NOTE]
> **5-Minute Lease Expiry & Safety Fencing Contract**:
> - `DEFAULT_LEASE_DURATION_SECONDS = 300` (5 minutes, defined in `src/lib/runbooks/types.ts:356`).
> - If an agent crashes or loses network connectivity mid-execution, its lease heartbeat expires after 300 seconds.
> - The reconciler (`src/lib/runbooks/reconciler.ts:202-249`) flags the step as `UNKNOWN` (`AGENT_LEASE_EXPIRED`).
> - For non-idempotent operations, the execution halts safely at `UNKNOWN_OUTCOME` to prevent catastrophic duplicate mutations on surviving agents.
> - Any late attempt by the original agent to submit output is blocked with HTTP `409 Conflict`.

---

## 3. Physical HA Execution Receipts

### HA-001 Execution Receipt

```json
{
  "test_id": "HA-001",
  "execution_id": "cmvdr7xco2ydw4qmqxxp0jizv",
  "result": "PASS",
  "pool": {
    "name": "E2E Fleet Pool",
    "mode": "SHARED_TARGET",
    "members": ["docker-host-agent", "docker-host-agent-ha-secondary"]
  },
  "primary_agent": {
    "name": "docker-host-agent",
    "state_before": "stopped (docker stop 9c30a68ed4c9)"
  },
  "secondary_agent": {
    "name": "docker-host-agent-ha-secondary",
    "state_before": "online",
    "action": "claimed execution cmvdr7xco2ydw4qmqxxp0jizv",
    "step_1": "start_docker_container -> Succeeded (exit 0, duration 3s)",
    "step_2": "verify_docker_health -> Succeeded (exit 0, duration 6s)"
  },
  "physical_workload_state": {
    "container": "ag-e2e-docker-api",
    "status": "running",
    "health": "healthy",
    "startedAt": "2026-10-18T11:40:46.066870968Z",
    "independent_probe": "http://localhost:8095/health -> HTTP 200 {\"status\":\"ok\"}"
  }
}
```

### HA-002 Execution Receipt

```json
{
  "test_id": "HA-002",
  "execution_id": "cmvescqg41wvmd9pahuz028jr",
  "result": "PASS",
  "pool": {
    "name": "E2E Fleet Pool",
    "mode": "SHARED_TARGET",
    "members": ["docker-host-agent", "docker-host-agent-ha-secondary"]
  },
  "primary_agent": {
    "name": "docker-host-agent",
    "state_before": "stopped (docker stop 9c30a68ed4c9)"
  },
  "secondary_agent": {
    "name": "docker-host-agent-ha-secondary",
    "state_before": "online",
    "action": "claimed execution cmvescqg41wvmd9pahuz028jr",
    "step_1": "start_docker_container -> Succeeded (exit 0, duration 4s)",
    "step_2": "verify_docker_health -> Succeeded (exit 0, duration 5s)"
  },
  "physical_workload_state": {
    "container": "ag-e2e-docker-api",
    "status": "running",
    "health": "healthy",
    "startedAt": "2026-10-19T05:00:16Z",
    "independent_probe": "http://localhost:8095/health -> HTTP 200 {\"status\":\"ok\",\"counter\":12}"
  }
}
```

### HA-003 Execution Receipt

```json
{
  "test_id": "HA-003",
  "execution_id": "cmvesgk6c1x92d9pa3jktzn77",
  "result": "PASS",
  "pool": {
    "name": "E2E Fleet Pool",
    "mode": "SHARED_TARGET",
    "members": ["docker-host-agent", "docker-host-agent-ha-secondary"]
  },
  "primary_agent": {
    "name": "docker-host-agent",
    "state_before": "online",
    "action": "claimed execution cmvesgk6c1x92d9pa3jktzn77",
    "step_1": "start_docker_container -> Succeeded (exit 0, duration 4s)",
    "step_2": "verify_docker_health -> Succeeded (exit 0, duration 5s)"
  },
  "secondary_agent": {
    "name": "docker-host-agent-ha-secondary",
    "state_before": "stopped (docker stop 938c51ae901c)"
  },
  "physical_workload_state": {
    "container": "ag-e2e-docker-api",
    "status": "running",
    "health": "healthy",
    "startedAt": "2026-10-19T05:03:15Z",
    "independent_probe": "http://localhost:8095/health -> HTTP 200 {\"status\":\"ok\",\"counter\":16}"
  }
}
```

UI Visual Evidence:

- `plans/runbook-engine/enterprise-physical-certification/screenshots/ha_failover_execution_receipt.png`
- `plans/runbook-engine/enterprise-physical-certification/screenshots/ha_002_failover_execution_receipt.png`
- `plans/runbook-engine/enterprise-physical-certification/screenshots/ha_003_failover_execution_receipt.png`
- `plans/runbook-engine/enterprise-physical-certification/screenshots/ha_003_failover_execution_detail.png`
- `plans/runbook-engine/enterprise-physical-certification/screenshots/ui_certified_execution_receipt_final.png`
