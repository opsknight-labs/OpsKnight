## OpsKnight SSO — Latest regression audit

Branch: `feat/enterprise-sso-2.1` · Commit `022dc69` · October 12, 2026

The existing SSO implementation has not been replaced, but its surrounding authentication behavior has changed. The branch continues to use OpsKnight's established OIDC provider, identity-resolution, and account-linking code while introducing database-controlled login modes, session-policy checks, and staged configuration.

This is the right general approach for backward compatibility. However, I would not yet guarantee that existing Microsoft or Google SSO installations will upgrade without interruption.

The latest branch is four commits ahead of `main` and one commit behind. It also contains new Docker Compose and Helm configuration changes, so deployment compatibility is part of this review—not just the login screen.

### What I verified about existing SSO

| Existing behavior                                           | Result                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Existing Microsoft/Google/other OIDC provider configuration | Preserved during initial policy import                                                 |
| Existing issuer-and-subject identity links                  | Not deleted or recreated by migration                                                  |
| Existing user IDs, teams, and incident history              | Preserved by the reviewed authentication changes                                       |
| Existing OIDC login callback                                | Still uses the established authentication flow                                         |
| Existing OIDC sessions after upgrade                        | Designed to remain valid if provider configuration and session policy remain unchanged |
| Entra ID without `email_verified` claim                     | Explicit compatibility tests exist                                                     |
| Existing role mapping                                       | Retained, but must be tested against real provider claims                              |
| Provider rotation or activation                             | Can intentionally invalidate OIDC sessions and require new login                       |

So the normal, already-working SSO path looks largely preserved. I did not find a definite defect that would make every existing OIDC login fail immediately after upgrading.

But I found two upgrade concerns worth addressing.

## 1. Important findings

P1 — Kubernetes rolling upgrades need explicit compatibility handling

The 2.1 documentation warns against mixing older and newer application replicas, yet the integrated and split Helm deployments still use `RollingUpdate` with `maxUnavailable: 0` and `maxSurge: 1`.

This deliberately allows both versions to serve traffic simultaneously. The new version also introduces authentication state and a `SECURITY` notification enum that older code may not understand.

Fix: Establish and test a compatible two-phase rollout, or provide a controlled cutover strategy with a documented availability trade-off. Do not treat the existing rolling-update configuration as certified for this release.

Files: `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `split-deployments.yaml`, and the 2.1 configuration reference.

P1 — Mixed-mode break-glass migration changes normal login behavior

Previously, when both `AUTH_LOCAL_LOGIN_ENABLED=true` and `AUTH_BREAK_GLASS_ENABLED=true`, the designated administrator could use ordinary password login.

The new import stores that administrator as a legacy emergency identity, and the credentials-login code unconditionally rejects normal login for that email.

Fix: Distinguish a true SSO-only legacy recovery account from an optional-login administrator who also happens to be designated for break-glass access. Add both upgrade scenarios to regression tests.

Files: `src/lib/authentication-policy.ts` and `src/lib/auth.ts`.

P2 — Provider changes can cause brief replica inconsistency

Activating a new OIDC revision resets authentication caches on the replica handling the request. Other replicas can retain cached provider configuration temporarily, and in-flight OIDC logins may complete against a changed registration.

Fix: Test cross-replica activation, in-flight callbacks, and cache convergence. Make interrupted logins recover cleanly without account duplication or redirect loops.

### Other checks

The latest branch has fixed many of the previous audit findings: scoped password restoration, emergency-session rotation checks, compromised-key handling, distributed failure aggregation, bounded session counting, invitation delivery, and a pinned-origin recovery path.

The new code also gives substantial attention to session-policy revocation and linked-account preservation.

One remaining compatibility concern is that the new administration console uses stricter provider-configuration validation than the existing runtime reader. Historical configurations with unusual but previously tolerated values should be tested against the new console before deployment.

## 2. Tests required before I would approve an upgrade

I would specifically require a realistic 2.0.0 → 2.1 upgrade test, not just a fresh installation test.

| Test                                           | Expected outcome                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Upgrade an existing SSO Optional installation  | Existing users can sign in through SSO and passwords as before                |
| Upgrade an existing SSO Required installation  | Existing SSO login works; prohibited passwords remain blocked                 |
| Preserve the first administrator               | Same User ID, ADMIN access, links, and operational records                    |
| Existing OIDC session before and after upgrade | Remains valid unless an explicit security cutoff requires logout              |
| Entra login with missing `email_verified`      | Retains documented provider-specific behavior                                 |
| Existing account-link approvals                | Preserve or invalidate only according to a documented migration rule          |
| Upgrade with break-glass variables set         | No unexpected ordinary-admin lockout                                          |
| Multiple web replicas and database migration   | No incompatible mixed-version requests or unexplained authentication failures |
| Provider change and rollback                   | Correct callbacks, sessions, identity ownership, and recovery                 |

The branch's latest progress report records 5,697 passing unit tests, 42 PostgreSQL integration tests, and a passing production build. Those are developer-reported results, not tests I independently executed. The GitHub checks visible on this commit cover other subsystems rather than providing a completed SSO-specific release certification.

## 3. Verdict

Existing SSO code compatibility

# 8.5/10

Source-based assessment

Safe production upgrade

# 7/10

Pending upgrade certification

Would I merge now? Not yet. The existing OIDC functionality appears well preserved, and the implementation is significantly more mature than the earlier branch. But I would first fix the mixed-mode migration regression, resolve the Kubernetes rollout incompatibility, and successfully test an upgraded copy of an existing SSO deployment.

That is the evidence needed before confidently saying existing SSO will continue working after 2.1.

[View current branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)
