# OpsKnight Runbook Engine — Step & Input Runtime Matrix

## 1. Overview & Scope

The OpsKnight Runbook Engine defines 10 distinct step types and 7 typed inputs. All 10 step types and 7 input types were verified through real runtime execution, unit tests, and interactive UI schema validation.

---

## 2. Step Type Runtime Matrix (10/10 Certified)

| Step Type                | Execution Boundary | Risk Classification | Runtime Capabilities Tested                                             | Verification Status |
| ------------------------ | ------------------ | ------------------- | ----------------------------------------------------------------------- | :-----------------: |
| **1. MANUAL**            | UI / Operator      | Read Only           | Operator sign-off, checklist acknowledgement, timeout cancellation      |    **CERTIFIED**    |
| **2. APPROVAL**          | UI / Responder     | Approval Required   | Explicit approval gate, rejection handling, tampered plan rejection     |    **CERTIFIED**    |
| **3. CONDITION**         | Control Plane      | Read Only           | Typed comparison, boolean evaluation, string matching, branching        |    **CERTIFIED**    |
| **4. WAIT**              | Control Plane      | Read Only           | Non-blocking timer delay, worker restart survival, deadline enforcement |    **CERTIFIED**    |
| **5. HTTP**              | Control Plane      | Safe to Repeat      | Public endpoint probe, SSRF prevention (loopback/private IP blocked)    |    **CERTIFIED**    |
| **6. LINUX_DIAGNOSTICS** | Agent Runtime      | Read Only           | CPU/memory telemetry, journalctl logs, DNS resolution, disk usage       |    **CERTIFIED**    |
| **7. SYSTEMD**           | Agent Runtime      | Approval Required   | Unit status, start, stop, restart, exit code 3 handling                 |    **CERTIFIED**    |
| **8. DOCKER**            | Agent Runtime      | Idempotent Write    | Container inspect, logs, start, stop, restart, health check             |    **CERTIFIED**    |
| **9. KUBERNETES**        | In-Cluster Agent   | Approval Required   | Deployment rollout status, rollout restart, replica scaling             |    **CERTIFIED**    |
| **10. BASH**             | Agent Runtime      | Approval Required   | Allowlists, arguments sanitization, timeout enforcement, secret masking |    **CERTIFIED**    |

---

## 3. Typed Inputs Runtime Matrix (7/7 Certified)

| Input Type        | Supported Validations             | UI Form Control    | Runtime Resolution & Evidence Masking             |    Status     |
| ----------------- | --------------------------------- | ------------------ | ------------------------------------------------- | :-----------: |
| **1. STRING**     | Regex patterns, min/max length    | Text Input         | Template interpolation (`{{inputs.my_var}}`)      | **CERTIFIED** |
| **2. NUMBER**     | Min/max bounds, integer/float     | Number Spinner     | Numeric arithmetic & threshold comparisons        | **CERTIFIED** |
| **3. BOOLEAN**    | Explicit true/false toggle        | Switch / Toggle    | Conditional step branching gates                  | **CERTIFIED** |
| **4. URL**        | Protocol (http/https), valid FQDN | URL Input          | SSRF filter validation, target URL construction   | **CERTIFIED** |
| **5. DURATION**   | Human readable (e.g. `30s`, `5m`) | Duration Picker    | Parsed to milliseconds for step timeout deadlines | **CERTIFIED** |
| **6. SECRET_REF** | Scoped vault secret binding       | Protected Selector | Cryptographic masking in logs (`[REDACTED]`)      | **CERTIFIED** |
| **7. SELECT**     | Static / Dynamic options enum     | Dropdown Select    | Single option selection with default fallback     | **CERTIFIED** |

---

## 4. UI Validation & Safety Limits

- Maximum steps per runbook: 50 steps enforced by schema.
- Maximum inputs per runbook: 30 inputs.
- Maximum target pool members: 100 targets.
- Prechecks & Postchecks: Evaluated before and after mutation steps.
