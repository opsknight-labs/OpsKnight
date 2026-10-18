# OpsKnight Runbook Engine — Shared-Target HA & Failover Results

## 1. Overview & Architectural Topology

Enterprise high availability requires genuine execution takeover between multiple independent agents sharing host or network reachability to the same target workloads, orchestrated under an explicit pool mode (`SHARED_TARGET`).

### Lab Infrastructure

- **Agent A (Primary)**: `docker-host-agent` (ID: `cmvbcv9lr02hz14mah9j953nm`, Hostname: `9c30a68ed4c9`), running via standalone Docker container with mounted `/var/run/docker.sock`.
- **Agent B (Secondary)**: `docker-host-agent-ha-secondary` (ID: `cmvdqw3n82xgj4qmqyaz4tk6m`, Hostname: `938c51ae901c`), running via Docker Compose (`deploy/compose/docker-compose.agent.docker-socket.yml`) with shared `/var/run/docker.sock`.
- **Agent Pool**: `E2E Fleet Pool` (ID: `cmvbde37o03hf14malayilfy6`), Mode: `SHARED_TARGET`.
- **Shared Target Workload**: `ag-e2e-docker-api` on port `8095:8080`.

---

## 2. Certified Failover Matrix (HA-001 through HA-012)

| Test ID    | Execution ID                | Scenario / Fault Injected                                 | Primary Agent State          | Secondary Agent State | Executing Agent                  | Physical Outcome                                                             |    Status    |
| ---------- | --------------------------- | --------------------------------------------------------- | ---------------------------- | --------------------- | -------------------------------- | ---------------------------------------------------------------------------- | :----------: |
| **HA-001** | `cmvdr7xco2ydw4qmqxxp0jizv` | Both Agents online, hard crash of Agent A before dispatch | Hard Stopped (`docker stop`) | Online                | `docker-host-agent-ha-secondary` | Target container started (`StartedAt: 11:40:46Z`), `/health` returned 200 OK |   **PASS**   |
| **HA-002** | `UNEXECUTED`                | Agent A offline before dispatch                           | Offline                      | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-003** | `UNEXECUTED`                | Agent B offline before dispatch                           | Online                       | Offline               | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-004** | `UNEXECUTED`                | Agent A fails immediately after claim, pre-mutation       | Crashed                      | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-005** | `UNEXECUTED`                | Agent A fails during physical write                       | Crashed                      | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-006** | `UNEXECUTED`                | Agent A finishes write, crashes before reporting          | Crashed                      | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-007** | `UNEXECUTED`                | Stale lease reconnection                                  | Expired                      | Reconnecting          | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-008** | `UNEXECUTED`                | Secondary agent lacks required capabilities               | Lacking Docker               | Offline               | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-009** | `UNEXECUTED`                | Local agent policy denies requested action                | Online                       | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-010** | `UNEXECUTED`                | Pool membership detached mid-execution                    | Removed                      | Online                | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-011** | `UNEXECUTED`                | Both pool agents offline                                  | Offline                      | Offline               | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |
| **HA-012** | `UNEXECUTED`                | Simultaneous poll race                                    | Polling                      | Polling               | Staged                           | Staged for distributed multi-node chaos test suite                           | `NOT_TESTED` |

---

## 3. Physical HA-001 Execution Receipt

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

UI Visual Evidence:
`plans/runbook-engine/enterprise-physical-certification/screenshots/ha_failover_execution_receipt.png`
`plans/runbook-engine/enterprise-physical-certification/screenshots/ui_certified_execution_receipt_final.png`
