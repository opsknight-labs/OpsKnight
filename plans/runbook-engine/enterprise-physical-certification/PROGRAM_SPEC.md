<USER_REQUEST>

# OpsKnight Runbook Engine — 10/10 Enterprise E2E Certification Program

## Objective

Bring the OpsKnight Runbook Engine to an evidence-backed, enterprise-production qualification standard across the entire workflow:

**Detection → Alert → Incident → Service Rule → Runbook → Agent Selection → Authorization → Execution → Physical Recovery → Verification → Audit**

The scope includes the control plane, UI, PostgreSQL, workers, Agent runtime, Docker, Docker Compose, Kubernetes Helm/Kustomize, Linux Systemd, rootless Podman and Docker Swarm.

**Non-negotiable rules:**

- Inspect the actual implementation before testing or fixing it.
- Use the interactive OpsKnight UI for normal operator workflows.
- Use terminal commands to deploy workloads, inject faults, verify infrastructure and execute automated tests.
- Do not create incidents manually in tests claiming automatic remediation.
- Do not bypass approvals, local Agent policy, RBAC or security boundaries.
- Keep service automation configuration in the UI; do not introduce new feature configuration switches in `.env`.
- Never equate a healthy fixture, successful build or green CI with complete end-to-end certification.
- Do not merge automatically as part of this testing program.
- Every discovered defect requires a root-cause fix and a regression test.

---

## Phase 0 — Establish the certification environment and evidence system

### 0.1 Prepare the branch

After the current security-hardening and partial-certification changes are integrated into `main`, create:

`feat/runbook-physical-enterprise-certification`

Record and freeze:

- OpsKnight server commit SHA.
- Agent Git commit and image digest.
- Database migration revision.
- Worker version.
- Deployment manifests and chart revisions.
- Effective Runbook settings.
- Supported capabilities.
- Operating system and runtime versions.

Confirm that `https://opssentinal.com` actually runs the tested candidate SHA. If necessary, create a separate isolated candidate environment to prevent test workloads or secrets from affecting other users.

### 0.2 Create a test evidence collector

Every test must generate a machine-readable result tied to its exact build.

Minimum fields:

```text
test_id
test_run_id
candidate_commit
server_image_digest
agent_image_digest
environment
topology
test_start_time
test_end_time
service_id
integration_id
alert_fingerprint
incident_id
rule_id
rule_revision
runbook_version_id
execution_id
step_attempt_ids
agent_id
policy_hash
result
physical_state_before
physical_state_after
independent_health_result
log_artifact_paths
```

Test outcomes must be recorded as:

`PASS`, `FAIL`, `BLOCKED`, `NOT_TESTED`, or `NOT_SUPPORTED`.

A report marked PASS must link to real receipts or CI artifacts generated for that candidate—not merely reproduce commands that someone could run.

### 0.3 Automation architecture

Use one disposable test orchestrator to:

1. Provision fixtures and monitoring.
2. Establish a healthy baseline.
3. Inject a defined failure.
4. Observe independent monitoring events.
5. Retrieve the corresponding OpsKnight execution evidence.
6. Verify the physical target after remediation.
7. Validate cleanup and retention behavior.
8. Produce a redacted certification report.

Do not directly insert OpsKnight incidents, Agent claims, or Runbook executions into PostgreSQL for a scenario claimed as E2E.

**Phase gate:** Reproducible environment, version provenance and test evidence collection all working.

---

## Phase 1 — Certify every Agent installation method physically

Current certification only qualifies two methods through live execution. This phase must close all seven.

### Target environment

| Installation         | Test host                              | Required real-world verification                          |
| -------------------- | -------------------------------------- | --------------------------------------------------------- |
| Direct Docker        | Mac Docker Desktop                     | Install, enroll, execute, restart, upgrade                |
| Docker Compose       | Mac Docker Desktop                     | Compose lifecycle, persistence, real execution            |
| Kubernetes Helm      | Kind cluster                           | Helm install, RBAC, policy, real execution                |
| Kubernetes Kustomize | Separate Kind deployment               | Apply, enrollment, policy, real execution                 |
| Native Linux         | Disposable Linux VM with Systemd PID 1 | Native installer, service lifecycle, real execution       |
| Rootless Podman      | Disposable Linux VM                    | Rootless socket, user service, actual execution           |
| Docker Swarm         | Disposable Swarm cluster               | Stack deployment, Agent enrollment, real supported action |

Do not use a container pretending to be a full Linux host as the only evidence for native Systemd or rootless Podman qualification.

### Mandatory tests per method

- Generate installation instructions from OpsKnight UI.
- Confirm commands reference a valid, pinned Agent release.
- Create a new enrollment identity and token.
- Install using the exact generated instructions.
- Verify the Agent transitions to ONLINE.
- Confirm the server receives truthful platform capabilities.
- Verify Agent policy and actual target permissions.
- Execute one harmless read operation.
- Execute one explicitly authorized physical write.
- Restart the Agent process.
- Restart the host or container runtime when applicable.
- Verify identity persistence without re-enrollment.
- Upgrade the Agent release.
- Verify version/protocol compatibility.
- Test rollback and unsupported downgrade behavior.
- Revoke the Agent.
- Verify revoked identity cannot obtain or execute new work.
- Test invalid, expired and reused enrollment tokens.
- Test absent Docker/Podman socket, invalid Kubernetes RBAC, unavailable Systemd unit, missing policies and broken TLS.

**Important product improvement:** If an Agent is ONLINE but cannot actually access its advertised runtime, the UI must identify the runtime as unavailable or degraded. An apparently healthy Agent with unusable capabilities must not silently pass deployment readiness.

**Exit gate:** 7/7 installation methods pass a fresh-install, real-execution, restart and recovery sequence, or a specific method is clearly marked unsupported with a documented product decision.

---

## Phase 2 — Full unattended alert-to-recovery certification

This is the highest-priority outstanding capability.

Set up independent health monitoring using Prometheus, Blackbox Exporter and Alertmanager.

Use explicit service routing, integration authentication and realistic alert evaluation intervals.

The monitoring setup must actually detect workload failure; simply POSTing an invented alert from a script does not count as the primary full-path test. Synthetic webhook injection belongs in a separate integration contract suite.

### Mandatory recovery journeys

| Test     | Failure injection                                    | Runbook action                            | Expected result                                            |
| -------- | ---------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| AUTO-001 | Stop Docker test API                                 | Docker `start` and health verification    | Zero-touch recovery                                        |
| AUTO-002 | Stop direct Docker test API                          | Docker `start` and verification           | Zero-touch recovery                                        |
| AUTO-003 | Scale Kubernetes Deployment to zero                  | `scale` to 2 replicas and rollout status  | Zero-touch recovery                                        |
| AUTO-004 | Stop native Systemd API                              | Systemd `start` and status check          | Zero-touch recovery                                        |
| AUTO-005 | Stop rootless Podman API                             | Container `start` and health verification | Zero-touch recovery                                        |
| AUTO-006 | Fail Docker Swarm-installed Agent's supported target | Supported Agent operation                 | Correct physical recovery or documented unsupported action |
| AUTO-007 | Trigger a non-idempotent restart                     | `restart`                                 | Exact-plan approval required                               |
| AUTO-008 | Trigger a healthy-state duplicate alert              | Same recovery rule                        | No uncontrolled repeated mutation                          |

Every automatic rule must be configured through the UI:

1. Create and publish a valid immutable Runbook.
2. Bind it to the correct service.
3. Select AUTOMATIC.
4. Pin the published version.
5. Configure an `INCIDENT_CREATED` trigger.
6. Select a specific Agent or valid fixed pool.
7. Perform configuration validation.
8. Obtain fresh, successful Agent policy evidence.
9. Confirm budgets and risk controls.
10. Activate the rule.

Automatic rules must not have their safety gates removed merely to obtain a passing result.

### Required proof for each test

The report must show:

**Real unhealthy physical state → monitoring firing event → incident creation → trigger evaluation → automatic execution ID → Agent command output → physical recovery → independent monitoring recovery.**

Check `triggeredByType = TRIGGER` and verify no operator execution authorization occurred for the zero-touch cases.

Any run initiated through **Run now**, **Preview plan → Execute**, or manually created incident must be labeled accordingly.

### Negative-path tests

- Monitoring flapping.
- Duplicate firing alerts.
- Delayed resolved alerts.
- Invalid integration credentials.
- Wrong service routing.
- Rule paused while matching.
- Runbook archived.
- Published version unavailable.
- Trigger edited during evaluation.
- Expired policy evidence.
- Offline Agent.
- Unavailable Agent capability.
- Invalid runtime permission.
- Automatic budget exhausted.
- Circuit breaker active.
- Multiple matching rules on the same service.

Verify no duplicate incident, execution or unsafe write results from concurrency races.

**Exit gate:** Every supported idempotent recovery topology has a complete, zero-touch execution receipt. Every approval-gated operation has a separate real-world approval journey.

---

## Phase 3 — Real two-Agent shared-target HA and failover

Current evidence demonstrates Agent reconnect, not genuine execution takeover.

### Required infrastructure

Create two independent Kubernetes Agents:

- `cert-ha-agent-a`
- `cert-ha-agent-b`

Both must access the same namespace and Deployment with independently verified authorization.

Place them in a `SHARED_TARGET` Agent pool.

Use a real workload such as `cert3-ha-api`.

Never substitute a Docker-host Agent and an unrelated Kubernetes Agent for this test.

### Mandatory tests

| ID     | Failure                                                   | Expected behavior                                                          |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| HA-001 | Both Agents online                                        | One eligible Agent claims and executes                                     |
| HA-002 | A offline before dispatch                                 | B executes                                                                 |
| HA-003 | B offline before dispatch                                 | A executes                                                                 |
| HA-004 | A fails immediately after claim but before physical write | Safe handling; eligible reassignment only when authoritative state permits |
| HA-005 | A fails during physical write                             | Execution remains uncertain if outcome cannot be proven                    |
| HA-006 | A finishes write but crashes before reporting             | No blind second write                                                      |
| HA-007 | Lease expires and Agent reconnects                        | Stale lease rejected                                                       |
| HA-008 | B lacks Kubernetes RBAC                                   | B cannot perform unauthorized action                                       |
| HA-009 | B local policy denies action                              | Policy denial enforced                                                     |
| HA-010 | Pool membership removed during execution                  | Authority fence enforced                                                   |
| HA-011 | Both Agents offline                                       | Visible failure/pending state; no silent success                           |
| HA-012 | Two Agents poll simultaneously                            | No competing claim for the same attempt                                    |

### Required safety guarantees

- At most one valid active claim for an execution attempt.
- Lease/token fencing rejects stale results.
- No cross-tenant target substitution.
- No unauthorized fallback Agent.
- No automatic retry of an uncertain write merely because its action is classified idempotent.
- No false success after an unverified target mutation.

A real `UNKNOWN` outcome must remain visible with recovery instructions. It is acceptable for unsafe or uncertain operations to require human reconciliation.

**Exit gate:** Real shared-target failover passes, and crash-after-write ambiguity does not produce duplicate or unauthorized physical writes.

---

## Phase 4 — Certify all ten step types and seven input types

Build a dedicated published Runbook suite for every executor and control-flow type.

### Step-type execution matrix

| Type              | Mandatory runtime proof                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| MANUAL            | Operator completion, permissions, cancellation, audit                                    |
| APPROVAL          | Authorized approval, rejection, changed-plan rejection, duplicate approval               |
| CONDITION         | True, false, missing value, invalid operator, typed comparisons                          |
| WAIT              | Normal completion, deadline, cancellation and worker restart                             |
| HTTP              | Actual control-plane HTTP step, status handling, timeout and SSRF rejection              |
| LINUX_DIAGNOSTICS | Memory, disk, process, journal, DNS, TCP and network results                             |
| SYSTEMD           | Status, logs, start, stop, restart and denied unit                                       |
| DOCKER            | Docker and supported Podman operations, health and incorrect target                      |
| KUBERNETES        | Get/events, scale, rollout status, restart, denied namespace                             |
| BASH              | Allowed command, rejected command, unsafe argument, timeout, approval and secret masking |

For HTTP steps, use an approved reachable fixture. The control-plane HTTP executor rejects private/loopback destinations by policy, so a successful `curl localhost` on a developer machine cannot be substituted for an HTTP Runbook step.

For Bash and other Agent commands, exercise local allowlists, policy signatures and platform authorization independently.

### Inputs

Test all seven types: STRING, NUMBER, BOOLEAN, URL, DURATION, SECRET_REF and SELECT.

For each input type, test:

- Creation and editing.
- Validation and default value.
- Required/optional values.
- Published-version persistence.
- Rule-level override.
- Preview rendering.
- Runtime resolution.
- Invalid/missing values.
- Retry/failure behavior.
- Accurate execution evidence.
- Secret masking where applicable.

Test 30 inputs, 50 total nested/ordinary steps, immutable version updates, nested prechecks and postchecks, and maximum execution deadlines.

**Exit gate:** Every supported step and input type has runtime or control-plane behavior demonstrated at its appropriate execution boundary, including positive and negative tests—not just successful builder publication.

---

## Phase 5 — Thorough failure, crash and recovery certification

Test both expected operational failures and uncertain distributed-system boundaries.

### Inject real failures

1. Kill the Agent before it claims a job.
2. Kill it after a successful claim.
3. Kill it immediately before mutation.
4. Kill it while the external command is executing.
5. Kill it after physical mutation but before reporting success.
6. Interrupt network connectivity between Agent and OpsKnight.
7. Restart the Runbook worker.
8. Restart the trigger evaluator.
9. Stop PostgreSQL briefly.
10. Restart PostgreSQL and verify durable work recovery.
11. Expire an execution lease.
12. Cancel at an approval gate.
13. Cancel during a real external operation.
14. Force a step timeout.
15. Force external health verification to fail.
16. Revoke an Agent or its secret access during execution.
17. Rotate signing material while an Agent is disconnected.
18. Repeat a signed request with the same nonce.

### Verify all result states

Make sure the engine and UI accurately distinguish:

- SUCCEEDED
- FAILED
- TIMED_OUT
- CANCELLED
- WAITING_APPROVAL
- WAITING_AGENT
- UNKNOWN

Never report `SUCCEEDED` solely because a command returned exit code 0 if a required post-execution verification did not establish recovery.

Measure whether the system recovers its own execution queues after database or worker restarts without losing audit history, exposing secrets or retrying ambiguous writes unsafely.

**Exit gate:** Zero safety-invariant violations across repeated fault-injection runs. Unknown results, when unavoidable, are preserved and clearly explained rather than treated as successful recovery.

---

## Phase 6 — Complete Security and RBAC certification

Test all relevant actor types: administrator, authorized Runbook operator, responder, service-scoped user, read-only user, and unauthorized actor.

Test server enforcement, not only whether UI controls are hidden.

### Security scenarios

- Unauthorized Runbook create/edit/publish/archive/delete.
- Unauthorized rule activation, target editing and execution.
- Approval without the required capability.
- Attempts to approve stale or tampered plans.
- Secret access without an explicit scope grant.
- Revoked secret grants.
- Tampered Agent execution envelope.
- Wrong target identity.
- Expired/replayed request nonce.
- Agent credential revocation.
- Incorrect Agent capability reporting.
- Docker socket and local policy escalation attempts.
- Kubernetes namespace/RBAC breakout.
- Bash command injection and unsafe argument handling.
- HTTP SSRF to localhost, metadata services and internal networks.
- Logs, UI, artifacts and execution history leaking secrets.
- Unauthorized download of execution artifacts.
- Cross-service or cross-tenant data exposure.

Where supported policy calls for independent approval, test separation of duties; if the feature does not enforce that distinction, describe the actual approval model rather than claiming peer approval.

Confirm that all rejected operations leave the physical target unchanged.

**Exit gate:** No exploitable authorization bypass, cross-tenant disclosure, unapproved mutation or credential leak in the certified threat model.

---

## Phase 7 — Make the entire Runbook UI production-grade

Use Antigravity's interactive browser against the exact candidate build.

### Scope

Test the complete product, including:

- Runbook Library and lifecycle.
- Workflow Builder and action editors.
- Typed Inputs.
- Published versions and comparisons.
- Service → Runbooks and multiple independent rules.
- Agent enrollment and capabilities.
- Agent pool membership.
- Scoped Secrets.
- Automatic remediation budgets.
- Agent policy readiness.
- Incident → Runbooks.
- Execution History and timeline.
- Approval dialogs.
- Runbook Health and diagnostics.
- Audit and artifacts.

### Specific usability improvements

**1. Remove unnecessary internal terminology.** Present risk classifications using operator-friendly descriptions such as _Read only_, _Safe to repeat_, and _Approval required_, while retaining exact technical details in tooltips and execution evidence.

**2. Explain disabled actions.** Every disabled Activate, Publish, Check Policy, Approve, Execute or Retry action should reveal the actual blocker and link to its resolution.

**3. Improve execution observability.** Operators must be able to identify which Agent executed a step, why it was selected, which policy applied, the exact safe/unsafe operation, its outcome, and whether recovery was actually verified.

**4. Eliminate confusing navigation.** A service operator should be able to move directly from incident to relevant Runbook, service rule, Agent, execution and audit evidence without hunting across separate screens.

**5. Keep settings in the UI.** Automatic remediation budgets, activation controls, rule targets and service-specific behavior should remain administrator-configurable without environment-variable changes.

### Browser matrix

Test real interactions at:

- 320px, 375px and 390px mobile widths.
- 768px tablet.
- 1024px small laptop.
- 1440px desktop.
- 1920px large monitor.
- 200% browser zoom.

Run Chromium, Firefox and WebKit.

Test keyboard navigation, focus trapping, Escape behavior, dialogs, sticky actions, long outputs, pagination, filtering, search, errors, loading states, dark/light modes and authorization-specific UI.

**Exit gate:** All critical workflows work end to end, no critical inaccessible controls, no data misrepresentation, and no unresolved high-severity responsive or accessibility defects.

---

## Phase 8 — Performance, scale and database reliability

OpsKnight uses PostgreSQL-backed durable orchestration; the certification must demonstrate the database remains stable without requiring Redis.

### Benchmark scenarios

| Scenario                    | Test profile                                             |
| --------------------------- | -------------------------------------------------------- |
| Baseline                    | 1 Agent, 1 execution                                     |
| Moderate execution load     | 10 simultaneous incidents                                |
| Concurrent recovery         | 50 simultaneous incidents                                |
| High-concurrency simulation | 100 concurrent incident/execution scenarios              |
| Idle Agent fleet            | 10, 100, 500 and 1,000 authenticated simulated Agents    |
| Multiple Agents             | Two or more physical Agents sharing one target           |
| Runbook library             | 100, 1,000 and 10,000 fixture records                    |
| Alert storm                 | Duplicates, flapping, distinct fingerprints              |
| Database pressure           | Limited connection pool, slow queries, worker contention |
| Artifact pressure           | Large bounded outputs, retention and cleanup             |

Do not report simulated fleet capacity as a physical 1,000-Agent production deployment.

### Measure

- Alert received → incident created.
- Incident created → trigger evaluated.
- Trigger evaluated → Agent claim.
- Agent claim → physical operation.
- Physical operation → independent recovery verified.
- End-to-end remediation time.
- p50/p95/p99 latency.
- Queue depth and backlog drain.
- Database connections and query durations.
- Lock contention and deadlocks.
- Worker CPU and memory.
- Agent CPU, memory and spool depth.
- Artifact generation and retention overhead.
- Error rate and retry behavior.

Establish explicit acceptance thresholds before the certification runs, tied to documented deployment resource profiles. Record actual capacity rather than inventing deployment guarantees.

Test graceful degradation under overload: new work must queue, reject or pause safely instead of overwhelming PostgreSQL or executing without authorization.

**Exit gate:** Published reproducible capacity results for each tested deployment profile; no lost execution state, uncontrolled connection exhaustion or unsafe concurrency behavior.

---

## Phase 9 — Operational lifecycle and upgrade qualification

An enterprise feature must remain correct after deployment changes, not just initial installation.

Test:

- Fresh installation and database migration.
- Upgrade of the OpsKnight server while Agents are connected.
- Upgrade of Agents while executions are pending.
- Server/Agent protocol compatibility.
- Deployment with Docker Compose and Kubernetes Helm.
- Native Linux installer upgrade and rollback.
- Kustomize deployment upgrades.
- Swarm Agent rolling deployment.
- Signing-key rotation and old-key invalidation.
- Staging backup and restore.
- Execution history retention after restore.
- Artifact retention and cleanup.
- Repeated worker and server restarts.
- Health Center reporting an unavailable worker or Agent.
- Operational runbooks for diagnosing stuck claims, stale leases and queue backlogs.

Verify deployment instructions against actual generated commands and manifest contents.

**Exit gate:** Supported upgrade and recovery paths do not corrupt workflow state or silently change authorization.

---

## Phase 10 — Evidence-backed final certification and release decision

Organize final evidence under:

`plans/runbook-engine/enterprise-physical-certification/`

Produce:

1. `CERTIFICATION-MANIFEST.md`
2. `AGENT-INSTALLATION-RESULTS.md`
3. `AUTOMATIC-RECOVERY-RESULTS.md`
4. `SHARED-TARGET-FAILOVER.md`
5. `STEP-AND-INPUT-RUNTIME-MATRIX.md`
6. `SECURITY-AND-RBAC-RESULTS.md`
7. `FAULT-INJECTION-RESULTS.md`
8. `BROWSER-AND-ACCESSIBILITY.md`
9. `PERFORMANCE-AND-CAPACITY.md`
10. `UPGRADE-AND-RESTORE.md`
11. `DEFECT-REGISTER.md`
12. `FINAL-RELEASE-ASSESSMENT.md`

Every report must have traceable identifiers, environment versions, physical before/after evidence, verified expected/actual results, CI artifact references, and explicit limitations.

### Release gates

| Gate | Mandatory requirement                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------- |
| G1   | Every supported Agent deployment method is physically verified                                            |
| G2   | Every supported safe automatic recovery journey works without manual incident creation or approval bypass |
| G3   | All required high-risk actions are correctly approval-gated                                               |
| G4   | Actual shared-target Agent failover is tested                                                             |
| G5   | No unsafe duplicate writes during crash/lease fault injection                                             |
| G6   | All 10 step types and 7 input types are verified at their supported runtime boundaries                    |
| G7   | All security and RBAC critical tests pass                                                                 |
| G8   | All browser E2E tests pass across the supported browsers                                                  |
| G9   | Performance results meet pre-agreed environment-specific thresholds                                       |
| G10  | All release-critical upgrades and recoveries pass                                                         |
| G11  | No unresolved P0/P1 defects                                                                               |
| G12  | Final candidate commit has fully green required CI and complete evidence                                  |

If any mandatory supported behavior is untested, the final certification must remain partial.

No amount of unit-test volume, documentation, or UI screenshots can compensate for a missing physical safety test.

---

## Recommended implementation sequence

### Workstream A — Automatic recovery first

Deliver the real Docker → Kubernetes → Systemd → Podman monitored recovery journeys.

This establishes whether the Runbook engine can actually complete its most important business function without an operator manually starting the workflow.

### Workstream B — Agents and high availability

Physically test the remaining installation methods, genuine two-Agent shared-target takeover, lost leases and uncertain physical writes.

### Workstream C — Complete feature and safety coverage

Finish the step/input runtime matrix, security, RBAC, approvals, negative paths, crash handling, upgrades and recovery.

### Workstream D — UI, performance and release certification

Complete browser coverage, resolve usability issues, benchmark representative deployment sizes and independently audit all evidence.

Each workstream must have its own test results, discovered bugs, corrective commits and review checkpoints.

## Final instruction to Antigravity

Treat this as an engineering implementation and certification program, not a documentation task.

Inspect the source, run the scenarios on real disposable infrastructure, identify missing implementation, fix any demonstrated defects, add automated regression tests, deploy the exact candidate revision and repeat the physical tests.

Do not mark a scenario complete unless it was executed successfully at its defined boundary. Do not weaken approval or retry safety to achieve a pass.

The final deliverable must be an OpsKnight Runbook Engine whose supported behavior is reliably demonstrated across realistic infrastructure failures, distributed execution, security boundaries, administrative operations and production-like load.

</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-18T15:29:34+05:30.
</ADDITIONAL_METADATA>
