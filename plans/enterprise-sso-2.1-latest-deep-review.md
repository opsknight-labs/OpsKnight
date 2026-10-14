## OpsKnight SSO 2.1 — Latest deep review

Branch: `feat/enterprise-sso-2.1` · Commit: `c59a20c` · Compared with `main`

The branch has improved since the last review. The two previous blockers have received fixes:

- Deployment CI is now green. The `deployment-manifests / validate` job passes, along with the other completed checks on this commit.
- The existing-user OIDC rotation race has been addressed in the code. New registration-version checks and concurrency tests have been added. I'm reviewing their transaction boundaries to determine whether the fix is complete.

The branch is currently 7 commits ahead and 2 behind `main`. I also found new authentication load-test results, a local certification guide, and additional upgrade tests.

The remaining question is whether these changes are sufficiently robust for production—not just whether the tests are green.

## New finding — Staged SSO test has an Entra compatibility gap

P1 — Confirmed code-path inconsistency

In `src/lib/auth-control/oidc-revisions.ts`, the real administrator SSO test requires both `sub` and an `email` claim in the returned ID token.

However, the existing production OIDC identity resolver allows an already-linked account to authenticate through its stable issuer/subject identity, even when a later token omits email.

This matters for Microsoft Entra, where email-related claims are not always present in the form an application expects.

Possible outcome: An existing administrator's production SSO login works, but the new staged verification refuses to validate their identity. That could prevent them from activating or repairing SSO through the new UI.

Recommended fix: When the issuer/subject is already securely linked to the selected administrator, allow the staged test to verify that stable binding without requiring a mutable email claim. Keep strict, explicitly approved ownership verification when creating a new link. Add both Entra cases to the integration tests.

[Review staged OIDC verification](https://github.com/opsknight-labs/OpsKnight/blob/c59a20c5fb112df71919c6b0762217afa8c36ee8/src/lib/auth-control/oidc-revisions.ts#L276-L315)

## Second finding — Emergency login can be globally rate-limited

P1 — Recovery availability risk

`src/lib/auth-control/emergency.ts` applies a shared 300 requests per five minutes limit to emergency login options, verification, and legacy recovery.

The limit is instance-wide, not specific to an account or client. Consequently, sufficiently sustained requests—even for nonexistent emergency account IDs—could exhaust the shared budget and temporarily prevent a legitimate administrator from beginning or completing recovery.

The origin check and per-IP limits help constrain abuse, but they do not make the global budget unavailable to an attacker who can reach the public application.

Recommended changes: Add a load/abuse test demonstrating recovery availability under distributed failed attempts. Consider separate protected quotas for legitimate in-progress ceremonies, account-aware verification budgets, and infrastructure-level attack mitigation. Avoid an unbounded exception that could expose the WebAuthn endpoints to resource exhaustion.

[Review emergency rate limits](https://github.com/opsknight-labs/OpsKnight/blob/c59a20c5fb112df71919c6b0762217afa8c36ee8/src/lib/auth-control/emergency.ts#L89-L105)

## 4. Full status against our SSO 2.1 plan

| Area                                                 | Latest assessment                                           |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| First administrator preserved                        | Implemented and covered by upgrade tests                    |
| Existing Microsoft/Google OIDC flow                  | Preserved architecturally; live provider acceptance pending |
| Existing sessions and identity links                 | Covered by released-version upgrade tests                   |
| Authentication modes                                 | Implemented and server-enforced                             |
| Password and session revocation                      | Implemented with database-backed policy                     |
| Independent emergency accounts                       | Implemented with WebAuthn                                   |
| Emergency session isolation                          | Implemented                                                 |
| Provider staging and rollback                        | Implemented                                                 |
| Real SSO administrator verification                  | Implemented; missing-email case needs correction            |
| Safe SSO Required activation                         | Implemented with readiness checks                           |
| Account linking, roles, SCIM separation              | Substantial implementation and regression coverage          |
| Admin-only settings and personal Security separation | Implemented                                                 |
| Security audit and notifications                     | Implemented; delivery/scale certification remains           |
| Deployment upgrade and rollback                      | Tested locally in Kind                                      |
| 2.1 documentation                                    | Substantially complete, with local certification evidence   |

### Security and existing SSO

The earlier linked-identity race now has a meaningful fix. Registration validation executes under database locks for existing and newly linked accounts; role/profile updates independently revalidate the registration and user security version before committing.

The branch also adds regression tests for a provider changing between identity resolution and profile synchronization, as well as a concurrent user deactivation.

I consider that previous race addressed at the source and database-test level. It still deserves live testing with real IdP sessions, but it is no longer an unfixed code-path gap.

## 5. Testing has improved significantly

The branch's committed certification record now includes:

| Test                                | Recorded result                                               |
| ----------------------------------- | ------------------------------------------------------------- |
| Unit tests                          | 5,725 passed, 4 skipped                                       |
| Existing PostgreSQL suites          | 42 passed                                                     |
| Exact v2.0.0 upgrade and race tests | 11 passed                                                     |
| Kind upgrade                        | Successful controlled cutover                                 |
| Failed migration scenario           | Old runtime remained stopped                                  |
| Database outage                     | Protected access denied; original session recovered afterward |
| Backup rollback                     | Published old image worked against restored old database      |
| HTTP authentication checks          | 300 requests, zero errors                                     |
| GitHub deployment validation        | Passed                                                        |

These are committed development/certification results. I independently checked the GitHub workflow status and reviewed the evidence files, but I have not independently reproduced the local Kind or browser runs.

Recorded local authentication HTTP latency

p95 latency of 100 authenticated HTTP session requests per concurrency level, through local TLS/nginx/Kubernetes service. Diagnostic results, not a production benchmark.

0 ms200 ms400 ms600 ms800 ms10 concurrent25 concurrent50 concurrent

Local Kind, two application replicas, one Kubernetes node, 100 requests per concurrency level. Source: `plans/certification/enterprise-sso-2.1-kind-cutover.json`.

Zero errors is encouraging, but p95 latency above 500 ms in this small local run warrants investigation under controlled warmup and steady-state workloads. I would not interpret these results as production throughput or high-availability certification.

## 6. Smaller gaps still worth addressing

| Priority | Finding or limitation                                               | Required follow-up                                                                                  |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P1       | Staged identity verification assumes an email claim                 | Support already-linked issuer/subject identities without relying on email                           |
| P1       | Anonymous traffic can exhaust the shared recovery-login budget      | Add recovery availability tests under sustained/distributed abuse                                   |
| P1       | Live provider compatibility remains untested                        | Test real Entra, Google, Okta, Auth0 and custom tenants                                             |
| P1       | Independent physical security keys not certified                    | Test loss, compromise, replacement and separate custodians                                          |
| P2       | Non-anonymous security events fan out to every active administrator | Bound and benchmark alert creation for large deployments                                            |
| P2       | Real multi-node HA and split-runtime cutover unverified             | Repeat the upgrade/failure tests in those topologies                                                |
| P2       | Branch is two commits behind `main`                                 | Integrate newer runbook/agent changes and rerun CI                                                  |
| P2       | Large authentication console                                        | Continue extracting focused components for maintainability                                          |
| P2       | Hosted CI doesn't show full SSO release certification               | Add dedicated authentication/upgrade checks or retain separately reviewable certification artifacts |

The non-anonymous alert fan-out is worth testing because `securityEvent()` performs administrator lookup and notification creation within the same security-operation transaction. That is useful for audit consistency but may increase transaction latency at scale.

## 7. Documentation review

The `docs/v2.1.0` tree now contains dedicated coverage for authentication modes, administrator migration, emergency access, provider staging, SSO enforcement, credential rotation, existing-installation upgrades, lockout recovery and local certification.

The new `local-certification.md` is particularly valuable: it records how the exact published 2.0.0 release was upgraded, how failures were injected, how rollback was tested, and where local testing stops short of production certification.

I would now focus documentation work on adding the results of real-provider and physical-key acceptance tests, plus correcting any instructions affected by the two new findings. Do not publish unsupported claims of universal compatibility or zero-downtime upgrades.

## 8. Updated verdict

Architecture

# 9/10

Security implementation

# 8.5/10

Existing SSO compatibility

# 9/10

Production readiness

# 8/10

Qualitative source-review estimates, not certified security or reliability scores.

Merge decision: I would still hold the feature branch. The previous CI and concurrency issues are addressed, and the upgrade evidence is much stronger. The remaining high-priority work is narrower: fix the staged verification compatibility gap, protect emergency-login availability under abuse, and complete real IdP/hardware acceptance.

I would not rewrite this implementation. It is approaching the standard we set at the beginning of our conversation.

[Review latest SSO branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)