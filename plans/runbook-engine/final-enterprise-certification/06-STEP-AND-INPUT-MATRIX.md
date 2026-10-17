# OpsKnight Runbook Engine — Phase 7: Step and Input Types Certification Matrix

## 1. Overview & Verification Scope

OpsKnight supports 10 canonical step types and 7 typed workflow input definitions. All 10 step types and 7 input types were configured, schema-validated, and published in the immutable publication `E2E Full Platform Remediation Suite` (`cmvc4ehbq0h5o11uzkxuk7x74`, version 2) on staging (`https://opssentinal.com`).

This matrix distinguishes between steps verified through **physical live execution** on infrastructure targets versus those verified through **builder schema and engine validation**.

---

## 2. Step Types Verification Matrix

| Step Type               | Builder Display     | Execution Target                  | Risk Class                | Default Safety Gate            | Verification Level     | Real Action Verified                                                                                                                                                                                                                           | Status                              |
| ----------------------- | ------------------- | --------------------------------- | ------------------------- | ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **`DOCKER`**            | Docker Action       | Agent (`docker-host-agent`)       | `SAFE_WRITE` / `MUTATION` | Optional / Required for mutate | **Physical Execution** | Container start (`ag-e2e-docker-api`) & Podman restart (`cert-podman-api`)                                                                                                                                                                     | **CERTIFIED**                       |
| **`SYSTEMD`**           | Systemd Action      | Agent (`linux-native-host-agent`) | `MUTATION`                | Approval-gated                 | **Physical Execution** | Unit restart (`cert-sample.service`) with reload verification                                                                                                                                                                                  | **CERTIFIED**                       |
| **`KUBERNETES`**        | Kubernetes Action   | Agent (`test-cert-agent-ui`)      | `MUTATION` / `READ_ONLY`  | Approval-gated                 | **Physical Execution** | Scale deployment & rollout restart in namespace `opsknight-cert`                                                                                                                                                                               | **CERTIFIED**                       |
| **`HTTP`**              | HTTP Request        | Local Engine / Server             | `READ_ONLY`               | Auto-executable                | **Engine Integration** | Control plane outbound HTTP dispatch, timeout & unknown-outcome fencing verified in integration tests (`runbook-execution-safety.test.ts:2204-2230`); target service verified via independent `/health` probe (`http://127.0.0.1:8095/health`) | **CERTIFIED (Integration & Probe)** |
| **`BASH`**              | Bash Script         | Agent (`docker-host-agent`)       | `MUTATION`                | Approval-gated                 | **Physical Execution** | Host diagnostics shell script execution                                                                                                                                                                                                        | **CERTIFIED**                       |
| **`LINUX_DIAGNOSTICS`** | Linux Diagnostics   | Agent (`linux-native-host-agent`) | `READ_ONLY`               | Safe auto-run                  | **Physical Execution** | System summary collection (`diagnostic: summary`) in execution `cmvc7w4xt`                                                                                                                                                                     | **CERTIFIED**                       |
| **`CONDITION`**         | Condition Guard     | Local Engine                      | `READ_ONLY`               | Safe branch                    | **Engine Execution**   | Incident state evaluation (`If incident.status equals OPEN`)                                                                                                                                                                                   | **CERTIFIED**                       |
| **`APPROVAL`**          | Human Approval Gate | Local Engine / UI                 | `READ_ONLY`               | Mandatory Pause                | **Interactive UI**     | Cryptographic execution freeze requiring authorized responder confirmation                                                                                                                                                                     | **CERTIFIED**                       |
| **`WAIT`**              | Delay / Timer       | Local Engine                      | `READ_ONLY`               | Auto-sleep                     | **Schema & Builder**   | Configured delay step validated in draft checks; timer execution verified in unit tests                                                                                                                                                        | **BUILDER / UNIT**                  |
| **`MANUAL`**            | Manual Instruction  | Human Operator                    | `READ_ONLY`               | Human confirmation             | **Schema & Builder**   | Checklist instruction schema and rendering validated                                                                                                                                                                                           | **BUILDER / UNIT**                  |

---

## 3. Input Types Verification Matrix

| Input Type       | Input Key         | Variable Expression             | Input Validation & Constraints           | Redaction Boundary  | UI Component            | Verification Level     | Status   |
| ---------------- | ----------------- | ------------------------------- | ---------------------------------------- | ------------------- | ----------------------- | ---------------------- | -------- |
| **`STRING`**     | `service_name`    | `${{ inputs.service_name }}`    | Required string, trim whitespace         | Clear text          | Text input              | Builder & Preview      | **PASS** |
| **`NUMBER`**     | `replica_count`   | `${{ inputs.replica_count }}`   | Required integer, min 1, max 10          | Clear text          | Number spinner / input  | Builder & Preview      | **PASS** |
| **`BOOLEAN`**    | `enable_debug`    | `${{ inputs.enable_debug }}`    | Optional boolean flag (true/false)       | Clear text          | Checkbox / Toggle       | Builder & Preview      | **PASS** |
| **`URL`**        | `health_endpoint` | `${{ inputs.health_endpoint }}` | Required RFC 3986 URL, http/https        | Clear text          | URL input field         | Builder & Preview      | **PASS** |
| **`DURATION`**   | `timeout_window`  | `${{ inputs.timeout_window }}`  | Required ISO 8601 or unit string (`30s`) | Clear text          | Duration picker         | Builder & Preview      | **PASS** |
| **`SECRET_REF`** | `api_secret_ref`  | `${{ inputs.api_secret_ref }}`  | Required vault secret ID / alias         | Masked `[REDACTED]` | Secret reference picker | Builder & Secret Scope | **PASS** |
| **`SELECT`**     | `target_env`      | `${{ inputs.target_env }}`      | Required enumerated option               | Clear text          | Single-select dropdown  | Builder & Preview      | **PASS** |

> [!NOTE]
> All 7 input types were validated for draft authoring, schema compliance, and binding serialization in `cmvc4ehbq0h5o11uzkxuk7x74` v2. Per-input runtime execution failure boundaries (e.g. malformed URL at runtime dispatch) are guarded by Zod schemas in `src/lib/runbooks/schemas.ts`.

---

## 4. UI Receipts & Builder Evidence

```text
Runbook ID: cmvc4ehbq0h5o11uzkxuk7x74
Name: E2E Full Platform Remediation Suite
Version: v2 (Published, Read-only)
Builder Configuration:
- 10 steps run top to bottom
- 5 mutation steps
- 5 approval gates
- 7 typed input bindings
Checks: Draft configuration checks passed, Ed25519 cryptographic digest verified.
```
