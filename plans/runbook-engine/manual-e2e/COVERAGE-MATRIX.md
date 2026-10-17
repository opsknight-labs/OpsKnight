# OpsKnight Runbook Engine — Feature & Environment Coverage Matrix

## 1. Step Type Qualification Matrix

OpsKnight supports ten first-class runbook step types. Below is the certified capability and qualification matrix validated during end-to-end testing against `https://opssentinal.com`.

| Step Type           | Classification    | Approval Policy                                                   | Target Type      | Certification Method                  | Verification Evidence                                                                 |
| :------------------ | :---------------- | :---------------------------------------------------------------- | :--------------- | :------------------------------------ | :------------------------------------------------------------------------------------ |
| `HTTP`              | Read-Only         | Auto-approved                                                     | Control Plane    | Manual execution & preflight          | RFC-compliant HTTP GET probe with response body validation                            |
| `BASH`              | Script / Command  | Configurable                                                      | Host Agent       | Agent execution (`docker-host-agent`) | Command execution with bounded output capture and exit code 0                         |
| `DOCKER`            | Container Action  | Idempotent Write (`start`) / Non-Idempotent (`restart`)           | Docker Agent     | **Journey A (Unattended Recovery)**   | `ag-e2e-docker-api` started unattended, reached `healthy`, HTTP 200 verified          |
| `KUBERNETES`        | Orchestration     | Non-Idempotent (`rollout-restart`) / Read-Only (`rollout-status`) | In-Cluster Agent | **Journey B (Approved Remediation)**  | Real rollout restart on `ag-e2e-k8s-api`, replica replacement verified                |
| `SYSTEMD`           | OS Daemon Action  | Idempotent (`start`) / Non-Idempotent (`restart`)                 | Linux Agent      | **Journey G (Systemd Remediation)**   | Real systemd service `cert-sample.service` restarted; PID changed `170592` → `184782` |
| `LINUX_DIAGNOSTICS` | System Inspection | Read-Only                                                         | Linux Host Agent | **Journey G (Host Diagnostics)**      | Live uptime, disk, and memory diagnostics collected on native Linux host              |
| `APPROVAL`          | Governance Gate   | Mandatory                                                         | User Responder   | UI Modal Dialogue                     | Cryptographically tied approval recorded with responder ID and timestamp              |
| `MANUAL`            | Human Task        | Mandatory                                                         | User Responder   | UI Checklist / Confirmation           | Operator-verified step checklist and instruction rendering                            |
| `WAIT`              | Flow Control      | Non-blocking                                                      | Control Plane    | Engine Scheduler                      | Non-blocking timer delay with guaranteed resumption                                   |
| `CONDITION`         | Logic / Branching | Read-Only                                                         | Control Plane    | Expression Evaluator                  | JSONPath and context comparison logic evaluation                                      |

---

## 2. Input Type Qualification Matrix

OpsKnight provides 7 first-class typed, validated inputs (`RUNBOOK_INPUT_TYPES`) that flow into step configurations and execution plans.

| Input Type   | Validation Rules                          | Default Value Support | Journey / Test Tested     | Status    |
| :----------- | :---------------------------------------- | :-------------------- | :------------------------ | :-------- |
| `STRING`     | Length bounds (1-80 key, 2000 val), regex | Yes                   | Journey A & B             | Certified |
| `NUMBER`     | Min, max, integer/float enforcement       | Yes                   | Journey A                 | Certified |
| `BOOLEAN`    | Strict boolean toggle                     | Yes                   | Journey B                 | Certified |
| `URL`        | Valid HTTP/HTTPS endpoint formatting      | Yes                   | Builder Tests             | Certified |
| `DURATION`   | Bounded execution interval format         | Yes                   | Builder Tests             | Certified |
| `SECRET_REF` | Reference to Secret Vault; masked in logs | Yes                   | Fleet Verification        | Certified |
| `SELECT`     | Whitelist of allowed options              | Yes                   | Builder & Execution Tests | Certified |

---

## 3. Execution Mode Qualification

| Mode        | Trigger Mechanism                         | Safety Enforcements                                                             | Qualification Scenario                                                                   |
| :---------- | :---------------------------------------- | :------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------- |
| `AUTOMATIC` | `INCIDENT_CREATED` event                  | Pinned version required, signed policy checks passed, non-idempotent budget = 0 | **Journey A**: Unattended recovery of `ag-e2e-docker-api` via `docker start`             |
| `SUGGESTED` | Incident created matching rule conditions | Offered to incident responders; runs on demand; stops at approval gates         | **Journey B**: Offered on `#cmvbh1wh`; plan preview authorized; rollout restart approved |
| `MANUAL`    | Explicit responder execution from UI      | Preview generation required; writes require explicit authorization checkbox     | Runbook Library & Execution details testing                                              |
| `CANCELLED` | Operator cancels execution at gate        | Immediately revokes authority; halts pipeline before mutating commands dispatch | **Journey I**: Approval cancelled in UI; `cert-sample.service` PID unchanged (`184782`)  |
| `FAILED`    | Precheck validation failure               | Enforces blast-radius containment; aborts downstream mutation steps             | **Journey J**: Precheck failed on non-existent unit; Step 2 mutation safely blocked      |

---

## 4. Execution Targets & Topologies

| Target Environment    | Implementation Details                                       | Agent Enrollment                                                        | Qualifications Completed                                                                        |
| :-------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Docker Host**       | Native Docker daemon on Mac/Linux                            | `docker-host-agent` (`31eadaeb257e`)                                    | Container inspect, health probe, start action                                                   |
| **Kubernetes (Kind)** | Kubernetes v1.37.0 cluster (`opsknight-cluster`)             | `test-cert-agent-ui` (in `opsknight` ns)                                | In-cluster ServiceAccount auth, RBAC permissions, rollout restart, status check, scale recovery |
| **Linux Native Host** | Native Linux Host with Systemd PID 1 & Rootless Podman 5.4.2 | `linux-native-host-agent` (`cmvc6jewu00cs16noj7104weo`)                 | Host diagnostics, systemd service restart, rootless podman container inspect & restart          |
| **Agent Pool**        | `E2E Fleet Pool` (Mode: `SHARED_TARGET`)                     | Multi-agent pool membership (`docker-host-agent`, `test-cert-agent-ui`) | Dynamic agent selection, pool execution `cmvc81xvo025ar4wgxkp2hbc0` (2/2 steps succeeded in 8s) |
| **Control Plane**     | OpsKnight Backend Engine (EC2)                               | Native Control Plane                                                    | HTTP checks, Condition evaluation, Wait timers, Plan freezing                                   |
