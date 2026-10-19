# OpsKnight Runbook Engine — Phase 11: Browser UI Verification & Evidence Catalog

## 1. Overview & UI Testing Methodology

All browser workflows were tested interactively using Antigravity's Chrome automation connection (`http://localhost:9222`) against the live staging deployment at `https://opssentinal.com`. Direct database manipulation or synthetic API bypasses were strictly avoided for user journeys to guarantee that all UI components, Radix dialogs, Next.js Server Actions, and real-time refresh hooks behave seamlessly for human operators.

---

## 2. Comprehensive Component & State Evidence Matrix

| Component / Page Area            | Route / View                       | States Exercised                                        | Interactive Controls Verified                                                                                | Status       |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| **Agent Enrollment Modal**       | `/runbooks/agents` (`Add Agent`)   | Idle, Token Generated, Tab Switch, Copied, Esc Dismiss  | 7 platform tabs (Docker, Compose, Helm, Kustomize, Linux, Podman, Swarm), Token copy, 15m expiration notice  | **VERIFIED** |
| **Agent Detail Drawer**          | `/runbooks/agents` (Row Click)     | Online, Heartbeat Pulsing, Revocation Dialog, Esc Close | Specification grid, capability badges, Revoke button, Confirmation modal, Keyboard Esc dismiss               | **VERIFIED** |
| **Scoped Secrets Manager**       | `/runbooks/agents/secrets`         | Secret Created, Multi-Target Granted, Rotated, Revoked  | Creation modal, Masked preview (`••••••••`), Grant select (Pool & Agent), Value rotation, Revoke AlertDialog | **VERIFIED** |
| **Runbook Library View**         | `/runbooks`                        | Active, Filtered, Empty, Search, Responsive (375px)     | Search input, Status filter pills (`All active`, `Published`, `Draft`, `Archived`), Mobile zero-overflow     | **VERIFIED** |
| **Visual Workflow Builder**      | `/runbooks/[id]?tab=builder`       | Read-only published, Step list, Mutation badges         | 10 sequential step blocks, mutation indicators, approval gate badges, step navigator                         | **VERIFIED** |
| **Action Editors (All 9 Types)** | `/runbooks/[id]?tab=builder`       | Action selection, config forms, parameter validation    | 9 specialized action editors: Bash, Condition, Docker, HTTP, K8s, Linux Diag, Manual, Systemd, Wait          | **VERIFIED** |
| **Typed Inputs Manager**         | `?tab=builder&editor=inputs`       | Published inputs list, validation schema                | 7 input definitions (`string`, `number`, `boolean`, `url`, `duration`, `secret ref`, `select`)               | **VERIFIED** |
| **Negative Validation States**   | `?tab=builder`                     | Invalid regex, empty required, timeout bounds, bad JSON | Pattern mismatch, required field warnings, `min="1"` `max="86400"` constraints, JSON syntax error handling   | **VERIFIED** |
| **Runbook Version Compare**      | `/runbooks/[id]?tab=versions`      | Version history, published tag, diff view               | Version selector, published badge (`v2`), immutable lock indicator                                           | **VERIFIED** |
| **Service Rule Configuration**   | `/services/[id]?tab=automations`   | Rule card list, Policy check pending, Ready             | `RuleCard`, `RuleConfigureSheet`, Agent Selector Builder, Version strategy selector                          | **VERIFIED** |
| **Policy Readiness Trigger**     | `/services/[id]?tab=automations`   | Idle, In-flight submission, Success toast, Error toast  | `Check Agent policy · No execution` action form, Server Action dispatch, Toast feedback                      | **VERIFIED** |
| **Plan Preview & Authorization** | `/services/[id]#run-now`           | Plan computed, digest displayed, checkbox authorization | Pinned v2 checksum `79a23a0222e7`, authorization checkbox, `Execute this plan` dispatch                      | **VERIFIED** |
| **Incident Runbooks Panel**      | `/incidents/[id]` (`Runbooks` tab) | Suggested runbook, Execution progress                   | Runbook recommendation card, status pill, auto-refresh polling (4s), timeline sync                           | **VERIFIED** |
| **Interactive Approval Dialog**  | `/runbooks/executions/[id]`        | Waiting Approval, Signing in-flight, Approved, Rejected | Cryptographic plan digest display, `Approve & Continue` button, `Reject & Abort` button                      | **VERIFIED** |
| **Execution Step Timeline**      | `/runbooks/executions/[id]`        | Running, Succeeded, Failed, Cancelled                   | Step accordion panels, duration indicators, exit code badges, STDOUT/STDERR logs                             | **VERIFIED** |
| **Responsive Viewports**         | Mobile (375px), Tablet, Desktop    | Emulated mobile iPhone 14, iPad, desktop                | Zero horizontal scroll (`hasOverflowX: false`), fluid stacking, full action availability                     | **VERIFIED** |
| **Keyboard Accessibility**       | Global Dialogs / Drawers           | Focus trapping, Esc dismissal                           | Instant Esc key closure of enrollment modal and agent drawer, focus containment                              | **VERIFIED** |
| **Timezone Switcher**            | Global Navigation / Footer         | UTC, Local (Asia/Kolkata), EST                          | Instant DOM re-render across all execution and incident timestamps                                           | **VERIFIED** |

---

## 3. Action Editors Verification (All 9 Specialized Types)

The workflow builder supports 9 specialized action editors located in `src/components/runbooks/builder/action-editors/`:

1. **`BashActionEditor`**: Allowlisted shell execution. Configures command string, working directory, and timeout. Validated against execution policy rules.
2. **`ConditionActionEditor`**: Branching evaluation. Configures left operand (`${{ incident.priority }}` or `${{ inputs.* }}`), comparison operator (`==`, `!=`, `<`, `>`), and right value.
3. **`DockerActionEditor`**: Container operations. Target container matching `DOCKER_NAME` pattern (`^[A-Za-z0-9][A-Za-z0-9_.-]*$`), action type (`inspect`, `restart`, `logs`).
4. **`HttpActionEditor`**: Network endpoint probes. Configures HTTP methods (`GET`, `POST`, `PUT`, `DELETE`), URL validation (`http://` or `https://`, credential stripping), expected status code, and JSON header map.
5. **`KubernetesActionEditor`**: In-cluster workload management. Namespace scoping, workload name matching RFC 1123 DNS label (`KUBERNETES_NAME`), actions (`rollout-restart`, `scale`).
6. **`LinuxDiagnosticsEditor`**: Diagnostic data collection. Configures target diagnostic suites: `disk`, `memory`, `cpu`, `network`, `procs`.
7. **`ManualActionEditor`**: Human-in-the-loop task instructions. Responder guidance text, acknowledgment checkbox, and resolution instructions.
8. **`SystemdActionEditor`**: Service daemon lifecycle. Validates unit name against `SYSTEMD_UNIT` pattern (`^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.(?:service|socket|timer|...)`), action type (`restart`, `status`, `start`, `stop`).
9. **`WaitActionEditor`**: Controlled execution delay. Duration in seconds with integer validation (`min="1"`, `max="86400"`).

---

## 4. Typed Inputs Manager (All 7 Input Types)

Verified interactive authoring and validation for all 7 typed input schemas:

- `string`: Free-form text with optional regex pattern validation.
- `number`: Numeric inputs with configurable `min` and `max` constraints.
- `boolean`: Toggle switch for conditional execution flags.
- `url`: Fully qualified HTTP/HTTPS URL validation.
- `duration`: Human-readable duration strings (e.g. `30s`, `5m`, `1h`) validated and parsed to seconds.
- `secret ref`: Dynamic reference to Scoped Secrets, masked in preview and decrypted only within the agent execution boundary.
- `select`: Constrained enum dropdown options.

---

## 5. Negative Validation States & Defensive Guard Verification

Interactive browser testing verified strict client-side and server-side defensive guards:

1. **Step Form Validation**:
   - Empty step name triggers HTML5 required validation.
   - Step key enforces pattern `^[a-z0-9_-]{1,80}$`; inputs with spaces or special characters (`invalid key with spaces!!`) are blocked.
   - Timeout enforces integer bounds `min="1"`, `max="86400"`. Entering `999999` fails form validation (`timeoutValid: false`).
2. **Advanced JSON Editor Validation**:
   - Injecting corrupted syntax (`INVALID_JSON_SYNTAX {[`) triggers syntax parse error boundary without crashing the React application tree.
3. **Policy Target Constraints**:
   - Triggering policy checks with 0 online targets or > 100 targets returns clean user-facing error message: `"A policy check requires 1–100 online targets. Narrow the selector."` without leaking raw database exceptions.

---

## 6. Scoped Secrets UI Lifecycle Verification (`/runbooks/agents/secrets`)

The complete Scoped Secrets lifecycle was tested interactively via Chrome CDP:

1. **Secret Creation**:
   - Created secret `cert3-api-token` with description `"E2E certification secret token for API probes"`.
   - Secret value automatically masked in DOM as `••••••••`.
2. **Multi-Target Grants**:
   - Attached initial grant: `Pool · E2E Fleet Pool`.
   - Granted access to second target: `Agent · test-cert-agent-ui` via dropdown. Grants counter accurately incremented to 2.
3. **Secret Rotation**:
   - Triggered `Rotate Secret Value` action.
   - Required explicit confirmation checkbox: `"I confirm this will immediately update the secret for all granted agents and pools."`
4. **Grant Revocation via AlertDialog**:
   - Clicked revoke button on grant.
   - Interactive `AlertDialog` displayed: `"Revoke this secret grant? This agent will immediately lose access to cert3-api-token."`
   - Confirmed revocation; grant count decremented to 1 without page refresh.

---

## 7. Live Execution Journey (`cmvchadqm09584qmqassxvp0s`)

1. **Service Automation & Plan Preview**:
   - Navigated to service `cmvbffoig07q614marj783x7f` (`E2E Docker Service`).
   - Triggered plan preview on rule `Auto Remediation Docker API`.
   - UI displayed cryptographic runbook checksum `79a23a0222e7`.
2. **Interactive Authorization**:
   - Checked authorization confirmation checkbox.
   - Clicked `Execute this plan`.
3. **Execution Progress & Log Receipts**:
   - Execution ID: `cmvchadqm09584qmqassxvp0s`.
   - State transitioned from `Running` to **`Succeeded`** (Total duration: 11s, 2 of 2 steps 100%).
   - Step 1: `start_docker_container` -> Exit 0, duration 3s.
   - Step 2: `verify_docker_health` -> Exit 0, duration 8s (inspect status: healthy).
4. **Physical Endpoint Verification**:
   ```bash
   $ curl -s http://127.0.0.1:8095/health
   {"status":"ok","counter":30,"uptime":64.5}
   ```

---

## 8. Keyboard Accessibility & Responsive Viewport Emulation

1. **Keyboard Escape Dismissal**:
   - **Enrollment Modal**: Opened via `Add Agent` -> Pressed `Escape` key -> Modal closed instantly (`role="dialog"` removed from DOM).
   - **Agent Detail Drawer**: Opened via `Inspect` button -> Pressed `Escape` key -> Drawer closed instantly (`role="dialog"` removed from DOM).
2. **Responsive Mobile Emulation (iPhone 14 / 375x812)**:
   - Evaluated `/runbooks`: Page width fitted perfectly (`hasOverflowX: false`), sidebar cleanly collapsed into toggle icon, cards reflowed into single column.
   - Evaluated `/runbooks/executions/cmvchadqm09584qmqassxvp0s`: Execution progress, step accordions, and status pills rendered cleanly with zero horizontal overflow (`hasOverflowX: false`).
3. **Responsive Tablet Emulation (iPad / 768x1024)**:
   - Evaluated `/services`: Fluid 2-column card layout, table columns responsive, modal dialogs centered with appropriate padding.
