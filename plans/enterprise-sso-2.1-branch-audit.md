# OpsKnight Enterprise SSO 2.1 — Deep branch audit

Branch: `feat/enterprise-sso-2.1` · Commit: `c5b2aaa` · Compared against `main` and the agreed implementation specification

Verdict: Not ready to merge as the completed Enterprise SSO 2.1 feature.

The branch has a solid start on the authentication-policy backend, with meaningful improvements to session revocation and password restrictions. However, the core enterprise experience—independent emergency recovery, verified SSO onboarding, safe enforcement, and the complete administration UI—has not yet been built.

## 1. Implementation versus our plan

| Phase                                              | Status                    | Assessment                                                                                                |
| -------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Phase 0: Existing security gaps                    | Partial                   | Major safeguards added; emergency-session and recovery gaps remain                                        |
| Phase 1: Central policy engine                     | Substantially implemented | PostgreSQL policy, versioning, transactional controls, and tests exist; operational certification remains |
| Phase 2: Independent emergency access              | Not implemented           | No dedicated WebAuthn accounts, recovery console, or restricted emergency sessions                        |
| Phase 3: SSO onboarding and enforcement            | Not implemented           | No staged provider testing or verified-enforcement wizard                                                 |
| Phase 4: World-class administration UI             | Early implementation      | Simple policy form added; original large OIDC form remains                                                |
| Phase 5: Identity lifecycle and monitoring         | Limited changes           | Existing OIDC functionality retained; advanced management and diagnostics absent                          |
| Phase 6: HA and deployment certification           | Not certified             | No proven multi-replica, real-IdP, or failure-mode testing                                                |
| Phase 7: 2.1 documentation and final certification | Partial                   | Initial documentation updated; several required guides and runtime tests missing                          |

The branch contains 58 changed files in one commit. It also includes a detailed specification and progress record that acknowledges the incomplete phases.

The biggest positive: New SSO Required activation is intentionally blocked until proper recovery and administrator verification exist. That protects installations from prematurely enabling an unsafe configuration.

The biggest concern: Several behaviors already added to the branch need correction before this partial implementation should be considered production-hardened.

## 2. Confirmed issues and design gaps

I traced the authentication evaluator, JWT session lifecycle, policy-change action, OIDC configuration action, invitations, user management, session registry, streaming endpoints, and the 2.1 documentation.

### Security and recovery findings

| Priority | Finding                                                              | Why it matters                                                                                 |
| -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P0       | Imported SSO Required installations lack a safe provider-repair flow | A broken IdP may force administrators to re-enable ordinary password login before repairing it |
| P1       | Legacy emergency inactivity timeout is refreshed by passive requests | Background requests can effectively extend the intended 15-minute idle period                  |
| P1       | Emergency access is still a normal OpsKnight user                    | It retains ordinary user privileges and is not restricted to recovery operations               |
| P1       | Emergency sign-ins are logged as ordinary credentials logins         | Emergency activity cannot reliably be distinguished for dedicated alerting                     |
| P1       | Imported emergency-account lifecycle isn't manageable                | No dedicated UI to rotate, revoke, replace, or verify recovery credentials                     |
| P1       | Administrator policy changes need stronger concurrency testing       | Concurrent changes to administrator permissions and authentication policy must be proved safe  |
| P1       | SSO-only onboarding is incomplete                                    | Normal user invitation currently requires password operations to be allowed                    |

### Finding A — Recovery deadlock

P0 — Fix before production rollout

The active OIDC configuration action explicitly rejects edits when policy is `SSO_REQUIRED`:

[SSO configuration action](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/app/\(app\)/settings/security/actions.ts#L302-L311)

Consider this situation:

1. An existing installation imports `SSO_REQUIRED`.
2. The IdP client secret expires or the provider becomes unavailable.
3. An administrator logs in using the existing emergency password.
4. They attempt to repair the OIDC configuration.
5. OpsKnight tells them to switch to SSO Optional first.

That switch makes normal password authentication available to ordinary accounts again. If the provider is disabled, switching to Optional is also blocked.

Required solution: Keep recovery inside a restricted emergency workflow that permits a verified administrator to stage, test, and repair the IdP without temporarily enabling all users' local passwords.

The current restriction is a sensible temporary safeguard, but it isn't an acceptable permanent recovery design.

### Finding B — Emergency session timeout

P1 — Confirmed logic defect

In `src/lib/auth.ts`, legacy emergency sessions check `lastActivityAt` against a 15-minute idle timeout. However, the JWT callback also updates that timestamp on successful requests, including passive session evaluations.

See [JWT emergency handling](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/lib/auth.ts#L614-L622) and [activity update](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/lib/auth.ts#L832-L834).

A session with regular polling may therefore avoid the intended inactivity timeout.

Fix: Only refresh emergency activity from authenticated, deliberate user interaction. Passive requests must not renew idle time. Add tests simulating repeated background requests with no user interaction.

The one-hour absolute session limit provides another safeguard, but it does not make the idle-timeout behavior correct.

### Finding C — Emergency sign-ins aren't clearly identifiable

P1 — Audit and monitoring gap

The successful credentials-login path records:

`logLoginSuccess(..., 'credentials')`

It does so even when the credentials belong to the imported emergency identity.

See [credential authentication](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/lib/auth.ts#L416-L453).

Emergency sessions are classified later for session restrictions, but the login audit event is already recorded as a normal credentials login.

Fix: Add distinct events such as `auth.emergency.login.success`, `auth.emergency.login.failed`, and `auth.emergency.session.revoked`, with durable alert delivery.

### Finding D — Administrator policy-change race

P1 — Potential concurrency risk requiring testing

The policy-change transaction locks the `AuthenticationPolicy` row, but it reads the current administrator using an ordinary `findUnique`.

That protects concurrent policy updates but does not by itself prove that a simultaneous admin-role revocation cannot race the authorization decision.

Fix: Add a concurrency test that revokes the acting administrator while an authentication-policy transition is in progress. If necessary, lock or conditionally validate the administrator's security version as part of the same transaction.

This is a potential race, not a demonstrated exploit.

### Finding E — New SSO users cannot use the normal invitation workflow

In [`addUser`](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/app/\(app\)/users/actions.ts#L289-L334), user creation is guarded by `assertPasswordOperationAllowed()`.

Under SSO Required, that rejects the conventional password-invitation workflow.

JIT and SCIM provide alternative provisioning, but the admin UI should also support adding an existing directory user without issuing a password token.

Fix: Separate user creation from password invitation. An SSO-only invitation should create or prepare an account for identity linking without creating a password-based access path.

## 3. Authentication engine — detailed assessment

| Mechanism                               | Result                            |
| --------------------------------------- | --------------------------------- |
| Database-backed authentication policy   | Implemented                       |
| One-time legacy `.env` import           | Implemented                       |
| Advisory locking during import          | Implemented                       |
| Policy versioning                       | Implemented                       |
| Session method evaluation               | Implemented                       |
| Old-session revocation cutoffs          | Implemented                       |
| Server-side password restrictions       | Implemented across reviewed paths |
| Concurrent policy-change protection     | Good initial implementation       |
| SSO Required readiness enforcement      | Intentionally unavailable         |
| Independent emergency principal         | Missing                           |
| Verified administrator SSO login        | Missing                           |
| Staged provider activation and rollback | Missing                           |

The new evaluator in [`authentication-policy-evaluator.ts`](https://github.com/opsknight-labs/OpsKnight/blob/c5b2aaad29fd18ad89da69bc892c8822d3800d30/src/lib/authentication-policy-evaluator.ts) is a useful architectural improvement.

It distinguishes local credentials, OIDC, and imported emergency sessions. It also prevents previously revoked sessions from becoming valid again simply because the administrator later relaxes an authentication mode.

One additional requirement: Legacy policy migration must be tested with replicas that have inconsistent environment settings. The first successful import becomes authoritative, so configuration mismatches must be detected and surfaced clearly rather than silently accepted.

### Performance implications

The policy is currently read from PostgreSQL during protected-session evaluation. That improves consistency but adds database work to hot authentication paths.

I wouldn't introduce Redis immediately. I would first measure request-scoped duplicate reads, connection-pool usage, p95/p99 latency, login concurrency, and stream authorization checks under realistic load.

The code does not yet establish that this design will create a bottleneck, but it also hasn't been load-certified.

## 4. UI and user experience review

The branch adds `AuthenticationPolicySettings.tsx`, but the existing `SsoSettingsForm.tsx` is still the same large configuration interface, with the new authentication-policy component placed above it.

This is an incremental UI addition, not the redesign from the plan.

There are also two truthfulness problems.

| Current display                                                 | Problem                                                                                                | Better behavior                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| System shows SSO enabled based on provider configuration        | The effective mode may be Password Only                                                                | Show provider status separately from effective authentication mode         |
| Personal Security shows “SSO Active” when an identity is linked | A linked identity doesn't prove that the user signed in through SSO or that SSO is currently permitted | Show Linked Identity, Current Session Method, and System Policy separately |

A world-class SSO screen should clearly show the active provider, verified real-login status, effective mode, identity-linking readiness, emergency recovery readiness, and recent policy changes.

The current policy form also has no deployment-impact preview, guided provider verification, or independently tested rollback flow.

## 5. Documentation audit — `docs/v2.1.0`

The branch has started updating the right documentation tree, which is good.

The newly added `authentication-modes.md` accurately explains that new SSO Required activation is unavailable. The existing 2.1 OIDC guide also acknowledges the new policy, the legacy migration, and the limits of Test Connection.

However, the planned documentation program remains incomplete.

| Required documentation                    | Status                       |
| ----------------------------------------- | ---------------------------- |
| Authentication modes                      | Added                        |
| OIDC provider guides                      | Existing, partially updated  |
| Authentication architecture               | Updated                      |
| First-admin migration walkthrough         | Missing as a dedicated guide |
| Emergency account setup                   | Missing                      |
| Real sign-in verification and enforcement | Missing                      |
| Safe OIDC rotation and migration guide    | Missing                      |
| Lockout-recovery runbook                  | Missing                      |
| Emergency-access troubleshooting          | Missing                      |
| Comprehensive 2.1 certification evidence  | Missing                      |

A smaller inconsistency: the existing OIDC guide's frontmatter still describes its task as safely enforcing single sign-on, even though new enforcement is deliberately unavailable. That metadata should accurately describe what users can currently complete.

Important: Keep the release's 2.0.0 documentation and tests unchanged. Everything for this feature belongs in the upcoming 2.1.0 tree, and website publishing should continue through the established docs-sync workflow only.

## 6. Testing and certification

The branch progress report records 316 unit/component regressions passing, six dedicated PostgreSQL policy tests, five additional password-recovery integration tests, and TypeScript/lint success.

Those are encouraging developer-reported results. I have reviewed the corresponding source and tests, but haven't independently rerun them.

The release-critical tests still needed include real OIDC browser login, emergency WebAuthn authentication, failed-provider recovery, simultaneous role and policy changes, multi-replica session revocation, PostgreSQL outages, fresh-install migration, and mobile/accessibility testing.

I also found no pull request or associated pull-request workflow runs for this branch, so there is no independent PR CI result to treat as merge certification.

## 7. What to implement next

I recommend this order:

| Order | Work                                                              | Required outcome                                                    |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1     | Correct emergency idle timing and separate emergency audit events | Accurate sessions and reliable security monitoring                  |
| 2     | Build independent WebAuthn emergency identities                   | Two dedicated recoverable accounts, outside ordinary users and SCIM |
| 3     | Add secure provider repair and staged OIDC revisions              | Broken SSO can be repaired without enabling ordinary passwords      |
| 4     | Implement real SSO administrator verification                     | Enforcement tied to proof of an actual working login                |
| 5     | Build the enforcement wizard with lockout-prevention checks       | SSO Required can be enabled safely                                  |
| 6     | Implement SSO-only user onboarding                                | Admins can add users without password invitations                   |
| 7     | Complete the System administration UI and diagnostic views        | Clear, responsive, accurate authentication management               |
| 8     | Finish 2.1 documentation and full certification                   | Every supported behavior is documented and tested                   |

## Final assessment

Policy-engine foundation

# 7/10

Source-review estimate, pending runtime certification

Complete SSO 2.1 plan

# 3/10

Implementation completeness, not production security score

Bottom line: The architecture is moving in the right direction. I would keep this work and continue building on it, but I would not merge or market it as the complete enterprise SSO 2.1 feature yet.

The three most important next deliverables are independent emergency recovery, a safe way to repair broken SSO, and real administrator login verification. Those are what turn a functioning OIDC implementation into a dependable enterprise authentication system.