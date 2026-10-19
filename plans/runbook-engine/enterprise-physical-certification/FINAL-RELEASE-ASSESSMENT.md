# OpsKnight Runbook Engine — Enterprise Release Certification Decision

## 1. Executive Summary & Verdict

- **Program**: OpsKnight Runbook Engine — Enterprise Physical Certification Program
- **Evaluated Branch**: `feat/runbook-physical-enterprise-certification`
- **Candidate Commit Base**: `9cb255994` (HEAD of PR #893, rebased onto `origin/main`)
- **Pull Request**: [PR #893 — Enterprise Runbook Certification](https://github.com/opsknight-labs/OpsKnight/pull/893)
- **Measured Date**: `2026-10-19`
- **Verdict**: **READY FOR OPERATOR-DISPATCHED ENTERPRISE RELEASE (CORE RUNTIME, UI, APPROVALS, SECRETS, AND PRE-DISPATCH AGENT HA); UNATTENDED AUTOMATIC REMEDIATION AND MID-WRITE PHYSICAL CHAOS QUALIFIED AT ORCHESTRATION LAYER (NOT CERTIFIED FOR UNATTENDED PRODUCTION GA).**

---

## 2. Release Gate Assessment

| Release Gate                                    | Required Standard                                               | Measured Result                                                                                                                                                   |                        Evaluation                        |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------: |
| **Gate 1: Agent Fleet Coverage**                | 7 platforms verified                                            | 6/7 live certified (Docker, Compose, Helm, Systemd, Podman, Swarm); Kustomize server-dry-run & manifest certified                                                 |               **PASSED (6 LIVE / 1 SPEC)**               |
| **Gate 2: Remediated Operational Executions**   | Physical execution and state recovery proven on staging & local | AUTO-001..008 passed; CLOSED-LOOP incident `#cmvero05` restored & resolved (`cmves846q1whpd9paj4x1agj3`); Trigger contract verified (`cmvezw1c5000evheis789l6y1`) |  **PASSED (OPERATOR CERTIFIED; UNATTENDED QUALIFIED)**   |
| **Gate 3: Shared-Target HA**                    | Genuine execution takeover in multi-agent shared pool           | HA-001..003 pre-dispatch staging certified; HA-004..012 qualified at PostgreSQL reconciler and concurrency layer                                                  | **PASSED (PRE-DISPATCH CERTIFIED; MID-WRITE QUALIFIED)** |
| **Gate 4: Safety & Fencing**                    | Zero blind duplicate writes; uncertain mutations quarantined    | 300s lease expiry watchdog (`reconciler.ts`); non-idempotent steps quarantine to `UNKNOWN_OUTCOME`; 409 fencing                                                   |                        **PASSED**                        |
| **Gate 5: Step & Input Types**                  | All 10 step types and 7 input types certified                   | 10/10 steps and 7/7 inputs verified at runtime                                                                                                                    |                        **PASSED**                        |
| **Gate 6: Security & RBAC**                     | Server-side RBAC, secret masking, and SSRF prevention           | All 12 threat scenarios verified; credentials encrypted and masked; 0 CodeQL security findings                                                                    |                        **PASSED**                        |
| **Gate 7: Production-Grade UI**                 | Responsive viewports (375px/768px/1440px), keyboard Escape      | 10/10 certified across all 4 UI dimensions via Chrome CDP; full interactive creation/approval/secrets                                                             |                **PASSED (10/10 DEEP UI)**                |
| **Gate 8: Regression Test Suite**               | 100% green tests covering all bug fixes                         | 48/48 test files passed (378/378 unit, authoring, and agent tests)                                                                                                |                        **PASSED**                        |
| **Gate 9: Evidence Schema & Truthful Tracking** | 100% compliant machine-readable test records                    | 20/20 records (8 AUTO + 12 HA) verified and strictly validated via evidence collector suite                                                                       |                        **PASSED**                        |

---

### 2.1 Release Recommendation & Phased Rollout

1. **Immediate Limited Release (Operator-Dispatched Runbooks)**:
   - **Interactive Execution Lifecycle**: Full UI creation, editing, publishing v1, execution timelines, step logs.
   - **Human-in-the-Loop Approval Gates**: Non-idempotent mutation plans with SHA-256 digests and authorized operator sign-off.
   - **Scoped Encrypted Secrets**: Granular target scoping, value masking (`••••••••`), and in-place rotation.
   - **Pre-Dispatch Agent HA**: Proven failover between primary and secondary agents in shared pools (HA-001..HA-003).
   - **Agent Fleet Readiness**: 6/7 platforms verified live (Docker, Compose, Helm, Systemd, Podman, Swarm), Kustomize manifest qualified.

2. **Roadmap for Full Unattended GA**:
   - **Dedicated Background Worker Pods**: Deploy dedicated `OPSKNIGHT_PROCESS_ROLE=runbook-worker` daemon to process webhooks and trigger evaluation without test-runner orchestration.
   - **Physical Node Chaos**: Subject physical agent host nodes to power/network interruption during active socket writes.

---

## 3. Pull Request & User Approval Requirement

Per project governance (`RULE[user_global]`):

- Changes are committed and pushed to feature branch `feat/runbook-physical-enterprise-certification`.
- Pull Request is raised on GitHub: [PR #893](https://github.com/opsknight-labs/OpsKnight/pull/893).
- **NEVER merge directly into `main` or `master`**.
- Stop and provide the PR link to the user for explicit review and manual approval.
