# OpsKnight Runbook Engine — Bug Register & Resolution Log

This register catalogs all functional, architectural, and user-experience defects discovered during the end-to-end certification of the OpsKnight Runbook Engine, along with their root causes, code fixes, and regression test results.

---

### Bug #1: Kubernetes Agent Capability Probe RBAC Scope

- **Component**: `agent/src/capabilities.ts`
- **Severity**: High (Namespace-restricted Kubernetes agents)
- **Symptom**: In-cluster Kubernetes agents configured with standard namespace-scoped ServiceAccounts failed capability detection for `KUBERNETES`, reporting `Binary or runtime access unavailable` or permission denied during startup capability probes.
- **Root Cause**: The capability probe initially executed cluster-level administrative queries (`kubectl cluster-info` or reading broad `kube-system` resources) which are denied by least-privilege namespace-scoped ServiceAccount RBAC policies.
- **Resolution**: Updated the Kubernetes capability probe in `agent/src/capabilities.ts` to execute `kubectl get --raw=/version`. This unauthenticated API server endpoint validates cluster API reachability and valid ServiceAccount credentials without requiring cluster-wide administrative read permissions.
- **Regression Verification**: Verified on `test-cert-agent-ui` pod running in Kind cluster (`opsknight-cert` namespace): probe executes `kubectl get --raw=/version`, verifies API server connectivity, and reports `Kubernetes: Configured, Available` with 0 errors.

---

### Bug #2: Agent Setup Instructions Image Defaults and Policy Mount Path

- **Component**: `src/components/runbooks/AgentSetupInstructions.tsx`
- **Severity**: Medium (Deployability & Onboarding)
- **Symptom**: When enrolling agents via Helm and Kustomize tabs in the UI, generated manifests referenced non-existent staging container image tags and default policy mount locations incompatible with strict read-only filesystems.
- **Root Cause**: Hardcoded image path defaults lagged behind the v2.0.0 release packaging, and policy volume mount paths pointed to `/etc/opsknight-agent/policy` instead of `/etc/opsknight-agent/policy.json`.
- **Resolution**: Updated manifest generation in `AgentSetupInstructions.tsx` to default to `ghcr.io/opsknight-labs/opsknight-agent:v2.0.0` (with fallback to local overrides) and standardized volume mount subpaths.
- **Regression Verification**: Helm installation via UI instructions deployed cleanly without crash loops or mount failures.

---

### Bug #3: Fleet Agent Table False-Positive Warning Badges

- **Component**: `src/components/runbooks/agents/AgentFleetTable.tsx`
- **Severity**: Low / UX (Misleading Operator Guidance)
- **Symptom**: In the Fleet Agents table, agents with unconfigured optional capabilities (such as `Systemd` or `Podman` on an in-cluster Kubernetes agent) were marked with red/warning badges labeled `Disabled by local policy` or `Unavailable`, giving false alarms that the agent was degraded.
- **Root Cause**: The table cell badge logic evaluated `!available` rather than `configured && !available`, triggering warning styles for capabilities that were simply out-of-scope for the hosting platform.
- **Resolution**: Updated badge logic in `AgentFleetTable.tsx` to display neutral/dash indicators for capabilities where `configured: false`, and reserve warning tones strictly for capabilities that are configured but unavailable due to policy denial or runtime fault.
- **Regression Verification**: Verified table display: out-of-scope capabilities render as clean neutral indicators while active platform capabilities display green availability pills.

---

### Bug #4: Cluttered Agent Drawer Capability Breakdown

- **Component**: `src/components/runbooks/agents/AgentDetailDrawer.tsx`
- **Severity**: Medium / UX & Enterprise Readiness
- **Symptom**: Opening `Inspect Agent` presented a confusing, indiscriminate list of 10 disparate capability blocks with redundant "Disabled by local policy" warnings regardless of whether the agent was hosted on Linux VM, Docker container, or Kubernetes pod.
- **Root Cause**: The detail drawer lacked platform context awareness. It attempted to render every theoretical capability in equal visual weight.
- **Resolution**: Redesigned `AgentDetailDrawer.tsx` with:
  1. A prominent **Hosting Environment Banner** indicating the primary runtime platform (e.g. `Kubernetes In-Cluster Agent` or `Docker Container Host`).
  2. An **Active Capabilities Grid** showcasing platform-relevant, verified capabilities (`KUBERNETES`, `BASH`, `LINUX_DIAGNOSTICS`).
  3. A collapsed **Out-of-Scope Capabilities Disclosure** clearly separating out unconfigured runtimes without visual alarm.
- **Regression Verification**: Validated in live browser session: out-of-scope capabilities render as clean neutral indicators while active platform capabilities display green availability pills without visual alarm.

---

### Bug #5: React Synthetic Event Desync in Advanced JSON Editor

- **Component**: `src/components/runbooks/builder/JsonCodeEditor.tsx`
- **Severity**: Medium (Workflow Authoring Reliability)
- **Symptom**: When pasting workflow step definitions into the Advanced JSON Editor programmatically or via high-speed automated inputs, the editor textarea displayed updated JSON text, but React state retained previous draft state, preventing `Apply JSON to builder` from syncing.
- **Root Cause**: React caches the input value tracker on `HTMLTextAreaElement.prototype`. Direct DOM property updates do not trigger React's synthetic input listener.
- **Resolution**: Updated input handling to leverage native property setter overrides (`Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set`) combined with dispatched synthetic `input` and `change` events.
- **Regression Verification**: Validated bidirectional synchronization across 10 step types and 7 input types. Advanced JSON round-trips correctly and reflects instantaneously in builder tabs.

---

### Bug #6: Exposed Integration Credentials and Plaintext Token Display (P0 Security)

- **Component**: `src/components/incident/IncidentRunbooks.tsx`, `src/components/runbooks/builder/StepNavigator.tsx`
- **Severity**: Critical (P0 Security)
- **Symptom**: Integration webhooks with query parameters (e.g. `?integrationKey=...`) and HTTP action headers displayed sensitive tokens in step summary chips in plain text.
- **Root Cause**: UI step summaries directly reflected raw URL targets and query strings without sanitization.
- **Resolution**: Implemented credential sanitization and URL masking in `StepNavigator.tsx` and `IncidentRunbooks.tsx`. Rotated and revoked all disclosed Prometheus integration keys from the live control plane and replaced with fresh securely-scoped keys.
- **Regression Verification**: Live incident pages and workflow steps now display masked URLs (`.../api/integrations/...`) and scrubbed token parameters.

---

### Bug #7: Agent Token Pre-Staging Execution Contract (P1 Agent Architecture)

- **Component**: `src/lib/runbooks/agent-setup-commands.ts`
- **Severity**: High (P1 Deployment Reliability)
- **Symptom**: Generated Docker and Podman enrollment commands failed on fresh hosts because the container entrypoint tried to run the agent rather than executing shell token pre-staging commands. Additionally, `stat -c %g` failed on macOS/BSD hosts during socket permission checks.
- **Root Cause**: `docker run` was called without `--entrypoint sh`, and `stat` used Linux-only `-c` flags.
- **Resolution**: Added `--entrypoint sh` to all token pre-staging commands, implemented portable socket group detection (`stat -c %g ... || stat -f %g ...`), and added explicit warnings when local policy files are not found.
- **Regression Verification**: Validated across Docker and Podman setup generation tests in `tests/lib/runbooks/agent-deployment.test.ts` (30/30 unit tests passing).

---

### Bug #8: Executor Healthcheck Polling Timeout & Error Propagation (P1 Runtime Engine)

- **Component**: `agent/src/executor.ts`
- **Severity**: High (P1 Execution Engine)
- **Symptom**: Agent healthcheck polling loop defaulted to fallback timeouts rather than respecting step-configured `timeoutSeconds`. Retry loop failures did not propagate detailed exit codes and stderr.
- **Root Cause**: Executor referenced `attempt.step.config.timeoutSeconds` instead of checking `attempt.step.timeoutSeconds` first, and final failure return object omitted error propagation fields.
- **Resolution**: Updated polling to check `attempt.step.timeoutSeconds ?? attempt.step.config.timeoutSeconds` and propagated detailed error messages and status on retry exhaustion.
- **Regression Verification**: Added unit tests in `tests/lib/runbooks/agent-executor.test.ts` verifying step-level timeout override and retry status capture.

---

### Bug #9: Incident Step Timeline Stagnation & Tab Visibility (P2 UI / Reliability)

- **Component**: `src/components/incident/runbooks/IncidentRunbookRefreshButton.tsx`, `src/components/incident/IncidentRunbooks.tsx`
- **Severity**: Medium (P2 Usability & Operator Trust)
- **Symptom**: Active incident runbook executions required manual browser reloads to see step progress. Background polling wasted requests when browser tabs were hidden. `BASH` step classification allowed accidental automatic write execution.
- **Root Cause**: Lack of automated interval polling on in-flight executions, absence of tab visibility awareness (`document.visibilityState`), and `BASH` being classified as idempotent.
- **Resolution**: Added `IncidentRunbookRefreshButton` with 4-second auto-refresh polling while executions are active, paused polling when tab is hidden, added in-flight deduplication, and classified `BASH` steps strictly as `NON_IDEMPOTENT`.
- **Regression Verification**: Verified live in browser and validated with unit test suite in `tests/components/incident-runbook-refresh-timeline.test.tsx`.
