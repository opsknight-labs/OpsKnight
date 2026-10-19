# OpsKnight Runbook Engine — Phase 4 & 5: Physical Remediation & Recovery Journeys

## 1. Overview & Verification Topology

Physical runbook execution was evaluated across multiple runtime platforms. This report accurately distinguishes between **Approval-Gated Governance Flows**, **Operator-Initiated Executions**, and **Unattended Alert-Triggered Workflows**.

The certification environment includes:

1. **Kubernetes Rollout Remediation** (Kind cluster, namespace `opsknight-cert`, workload `ag-e2e-k8s-api`)
2. **Docker Container Lifecycle Remediation** (Host Docker daemon, workload `ag-e2e-docker-api`)
3. **Native Linux Systemd Remediation** (Unit `cert-sample.service` via Linux host agent)
4. **Rootless Podman Remediation** (Container `cert-podman-api` via Linux host agent)
5. **Phase 1 Lab Fixtures** (`cert3-docker-api`, `cert3-docker-direct-api`, `cert3-k8s-api`, `cert3-systemd-api`, `cert3-podman-api`, `cert3-swarm-api` with independent `/health` baselines)

---

## 2. Certified Execution Journeys

| Journey                      | Target Workload       | Execution Authority / Mode                     | Agent Selected                            | Step Sequence                                                                                                          | Physical Outcome                                                                                            | Status                         |
| ---------------------------- | --------------------- | ---------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Journey A (Kubernetes)**   | `ag-e2e-k8s-api`      | `SUGGESTED` / Approval-gated                   | `test-cert-agent-ui` (Pod in `opsknight`) | 1. Rollout restart (`rollout-restart`)<br>2. Rollout status check (`rollout-status`)                                   | Pods terminated and replaced with new replicas (`b4dbc5bf-5whnc`, `b4dbc5bf-mg2hj`). Live cluster verified. | **PASS (Approval-Gated)**      |
| **Journey B1 (Docker Live)** | `ag-e2e-docker-api`   | `OPERATOR-INITIATED` (Plan Preview on Rule v2) | `docker-host-agent`                       | 1. Start container (`start_docker_container`)<br>2. Verify health (`verify_docker_health`)                             | Container started, `/health` returned HTTP 200 `{"status":"ok"}`. Exec `cmvchadqm09584qmqassxvp0s`.         | **PASS (Operator Authorized)** |
| **Journey B2 (Docker Pool)** | `ag-e2e-docker-api`   | `MANUAL` / Shared-Pool Run                     | `docker-host-agent` (ID: `9c30a68ed4c9`)  | 1. Start container (`start_docker_container`)<br>2. Verify health (`verify_docker_health`)                             | Container started, `/health` returned HTTP 200 `{"status":"ok"}`. Exec `cmvc81xvo025ar4wgxkp2hbc0`.         | **PASS (Manual / Pool)**       |
| **Journey C (Systemd)**      | `cert-sample.service` | `APPROVAL-GATED`                               | `linux-native-host-agent`                 | 1. Host diagnostics<br>2. Precheck systemd status<br>3. Unit restart (`systemctl restart`)<br>4. Verify systemd status | Unit restarted cleanly, status `active`, duration 1s. Required operator sign-off in UI.                     | **PASS (Approval-Gated)**      |
| **Journey D (Podman)**       | `cert-podman-api`     | `APPROVAL-GATED`                               | `linux-native-host-agent`                 | 1. Precheck inspect<br>2. Rootless podman restart<br>3. Postcheck health verification                                  | Container restarted, status `Up`, duration 2s. Required operator sign-off in UI.                            | **PASS (Approval-Gated)**      |
| **Journey E (Swarm)**        | `cert3-swarm-api`     | Lab Deployment Verified                        | N/A                                       | Swarm stack deployment & service scaling                                                                               | Independent HTTP probe healthy; unattended alert-to-runbook execution pending rule binding                  | **FIXTURE VERIFIED**           |

> [!NOTE]
> **Operator-Authorized vs Zero-Touch Unattended**:
> The execution journeys above demonstrate verified physical command execution, cryptographic plan previews, and human approval gates. Fully unattended, zero-touch remediation (monitoring alert -> automatic incident creation -> automatic agent execution without human confirmation) is currently qualified for policy and engine dispatch, but requires explicit un-gated trigger rules for production deployment.

---

## 3. Physical Verification Receipts & Distinctions

### Journey A: Kubernetes Approval-Gated Rollout

```bash
# Physical Pods after rollout restart:
NAME                            READY   STATUS    RESTARTS   AGE
ag-e2e-k8s-api-b4dbc5bf-5whnc   1/1     Running   0          10s
ag-e2e-k8s-api-b4dbc5bf-mg2hj   1/1     Running   0          9s
```

_Note_: Execution was initiated via incident suggestion and paused at human approval gate (`WAITING_APPROVAL`) until confirmed by the operator in the UI.

### Journey B: Live Docker Container Remediation (`cmvchadqm09584qmqassxvp0s`)

This execution certifies the complete remediation chain triggered via rule `Auto Remediation Docker API` (pinned `v2` checksum `79a23a0222e7`) on service `cmvbffoig07q614marj783x7f`:

1. **Pre-Execution Plan Preview**:
   - Plan preview verified against cryptographic runbook definition hash: `79a23a0222e7`.
   - Explicit human authorization confirmed via UI modal.
2. **Step Execution Receipts**:
   - **Step 1**: Start Container (`start_docker_container`) -> **Succeeded** (Duration: 3s, Exit Code: 0). Output: Container `ag-e2e-docker-api` started.
   - **Step 2**: Verify Health (`verify_docker_health`) -> **Succeeded** (Duration: 8s, Exit Code: 0). Output: Docker inspect status confirmed `healthy`.
   - **Total Duration**: 11s (2 of 2 steps complete, 100%).
3. **Independent Host Verification**:
   ```bash
   $ curl -s http://127.0.0.1:8095/health
   {"status":"ok","counter":30,"uptime":64.5}
   ```

### Journey C: Docker Container Shared-Pool Run (`cmvc81xvo025ar4wgxkp2hbc0`)

```bash
# Execution cmvc81xvo025ar4wgxkp2hbc0 (Initiated via shared pool)
STEP 1: Start Container (start_docker_container) -> Succeeded (Duration 3s)
STEP 2: Verify Health (verify_docker_health) -> Succeeded (Duration 4s)
# Independent probe:
curl -s http://127.0.0.1:8095/health
{"status":"ok","counter":10876,"uptime":22409.89}
```

### Journeys D & E: Systemd & Podman Approval-Gated Execution (`cmvc7w4xt01n9r4wgcswc6x2l`)

```bash
7 of 7 steps complete (100%)
- Step 1: Capture Host Diagnostics -> Succeeded (3s)
- Step 2: Precheck systemd status -> Succeeded (4s)
- Step 3: Restart cert-sample.service -> Succeeded (1s, Approved by OpsKnight Admin)
- Step 4: Verify systemd status -> Succeeded (1s)
- Step 5: Precheck podman container inspect -> Succeeded (1s)
- Step 6: Restart podman container -> Succeeded (2s, Approved by OpsKnight Admin)
- Step 7: Postcheck podman container status -> Succeeded (1s)
```

_Note_: This execution demonstrates physical command execution and approval gate enforcement. Fully unattended, zero-touch remediation for Systemd/Podman requires removing human approval gates from the workflow definition, which is not recommended for production mutations.

---

## 4. Lab Fixtures (`cert3-*`) vs Live Workload Recovery

The `cert3-*` workload suite (`cert3-docker-api`, `cert3-docker-direct-api`, `cert3-k8s-api`, `cert3-systemd-api`, `cert3-podman-api`, `cert3-swarm-api`) represents baseline testing fixtures deployed to ensure endpoint health and target discovery. They are actively monitored and validated as healthy baseline targets. They should not be confused with workloads that underwent destructive failure injection; live recovery execution receipts are provided above for `ag-e2e-docker-api` (`cmvchadqm09584qmqassxvp0s`) and `ag-e2e-k8s-api`.
