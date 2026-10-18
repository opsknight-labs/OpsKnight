# OpsKnight Runbook Engine — Shared-Target HA & Failover Results

## 1. Overview & Architectural Topology

Enterprise high availability requires genuine execution takeover between multiple independent agents sharing host or network reachability to the same target workloads, orchestrated under an explicit pool mode (`SHARED_TARGETS`).

### Lab Infrastructure

- **Agent A (Primary)**: `docker-host-agent` (ID: `cmvbcv9lr02hz14mah9j953nm`, Hostname: `9c30a68ed4c9`), running via standalone Docker container with mounted `/var/run/docker.sock`.
- **Agent B (Secondary)**: `docker-host-agent-ha-secondary` (ID: `cmvdqw3n82xgj4qmqyaz4tk6m`, Hostname: `938c51ae901c`), running via Docker Compose (`deploy/compose/docker-compose.agent.docker-socket.yml`) with shared `/var/run/docker.sock`.
- **Agent Pool**: `E2E Fleet Pool` (ID: `cmvbde37o03hf14malayilfy6`), Mode: `SHARED_TARGETS`.
- **Shared Target Workload**: `ag-e2e-docker-api` on port `8095:8080`.

---

## 2. Certified Failover Matrix (HA-001 through HA-012)

| Test ID    | Execution ID                | Scenario / Fault Injected                                 | Primary Agent State          | Secondary Agent State | Executing Agent                  | Physical Outcome                                                             |  Status  |
| ---------- | --------------------------- | --------------------------------------------------------- | ---------------------------- | --------------------- | -------------------------------- | ---------------------------------------------------------------------------- | :------: |
| **HA-001** | `cmvdr7xco2ydw4qmqxxp0jizv` | Both Agents online, hard crash of Agent A before dispatch | Hard Stopped (`docker stop`) | Online                | `docker-host-agent-ha-secondary` | Target container started (`StartedAt: 11:40:46Z`), `/health` returned 200 OK | **PASS** |
| **HA-002** | `cmvc9ghp805sxr4wg5onxjl4c` | Agent A offline before dispatch                           | Offline                      | Online                | Agent B (`938c51ae901c`)         | Seamless claim and execution                                                 | **PASS** |
| **HA-003** | `cmvc8yj6e04j3r4wg4yqfl83j` | Agent B offline before dispatch                           | Online                       | Offline               | Agent A (`9c30a68ed4c9`)         | Seamless claim and execution                                                 | **PASS** |
| **HA-004** | `cmvc8s8p60433r4wg9whx7arr` | Agent A fails immediately after claim, pre-mutation       | Crashed                      | Online                | Agent B (`938c51ae901c`)         | Claim reset safely to PENDING; clean second execution                        | **PASS** |
| **HA-005** | `cmvc8nq9i03q1r4wgklbgtr2e` | Agent A fails during physical write                       | Crashed                      | Online                | Quarantined                      | Outcome uncertain; preserved as UNKNOWN, prevents unsafe second write        | **PASS** |
| **HA-006** | `cmvc81xvo025ar4wgxkp2hbc0` | Agent A finishes write, crashes before reporting          | Crashed                      | Online                | Reconciled                       | No blind second write; verified state preserved                              | **PASS** |
| **HA-007** | `cmvc7w4xt01n9r4wgcswc6x2l` | Stale lease reconnection                                  | Expired                      | Reconnecting          | N/A                              | Stale result submission rejected with HTTP 409 Conflict                      | **PASS** |
| **HA-008** | `cmvc7pkss012xr4wgqw03xncs` | Secondary agent lacks required capabilities               | Lacking Docker               | Offline               | N/A                              | Policy engine disqualifies incapable agent; blocks invalid dispatch          | **PASS** |
| **HA-009** | `cmvc6dcet0loz11uzmpbhcuzi` | Local agent policy denies requested action                | Online                       | Online                | Denied                           | Cryptographic policy denial enforced locally by agent                        | **PASS** |
| **HA-010** | `cmvc692k00la411uz45natjsl` | Pool membership detached mid-execution                    | Removed                      | Online                | Fenced                           | Authority fence enforced; execution gracefully revoked                       | **PASS** |
| **HA-011** | `cmvc4pnra0hud11uz8xptvmbx` | Both pool agents offline                                  | Offline                      | Offline               | None                             | Execution held safely in `WAITING_AGENT`; zero phantom successes             | **PASS** |
| **HA-012** | `cmvc1kgro0b7211uzueewpqtr` | Simultaneous poll race                                    | Polling                      | Polling               | Single Agent                     | PostgreSQL advisory lock prevents double-claim race                          | **PASS** |

---

## 3. Physical HA-001 Execution Receipt

```json
{
  "test_id": "HA-001",
  "execution_id": "cmvdr7xco2ydw4qmqxxp0jizv",
  "result": "PASS",
  "pool": {
    "name": "E2E Fleet Pool",
    "mode": "SHARED_TARGETS",
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
