# OpsKnight Enterprise SSO 2.1 — Full implementation audit

Branch: `feat/enterprise-sso-2.1` · Reviewed commit: `bb36e2e` · Compared with `main` and our complete SSO plan

Overall conclusion: OpsKnight has progressed significantly toward the design we agreed on. Most major features now exist, and the latest changes address the earlier concerns about preserving existing SSO installations.

However, I would not approve the production merge yet. There is a confirmed failing deployment CI check, and several production-level scenarios still need certification.

## 1. Progress against our original plan

| Original requirement                                    | Current assessment                           |
| ------------------------------------------------------- | -------------------------------------------- |
| Preserve the first administrator and existing users     | Implemented; migration tests added           |
| Three authentication modes managed from System settings | Implemented                                  |
| Preserve existing OIDC providers and identity links     | Implemented with upgrade regression coverage |
| Dedicated emergency identities with WebAuthn            | Implemented                                  |
| Two independently verified recovery accounts            | Implemented with readiness checks            |
| No long-lived emergency sessions                        | Implemented                                  |
| Staged OIDC configuration and real login verification   | Implemented                                  |
| Safe SSO Required activation                            | Implemented with readiness checks            |
| Restricted recovery console and provider repair         | Implemented                                  |
| Role mapping and SSO-only user invitations              | Implemented                                  |
| Session revocation, auditing and security notifications | Implemented                                  |
| Admin-level UI separated from personal Security         | Implemented                                  |
| 2.1 documentation updates                               | Substantially implemented                    |
| Production HA and real-provider certification           | Still outstanding                            |

This is far beyond the initial policy-engine-only branch we reviewed earlier.

## 2. Confirmed CI blocker

Deployment manifests validation is failing on the latest commit.

I retrieved the actual GitHub Actions failure log, rather than relying only on the red check.

deployment-manifests / validate

Failed

The workflow executes a Helm upgrade render without specifying an image tag or digest.

Error: execution error at opsknight/templates/authentication-cutover.yaml:3:4  Authentication cutover upgrades require an explicit tested image.tag or image.digest containing the cutover gate script

The chart's protection is intentional and correct; the CI workflow was not updated to meet that new requirement.

Fix the upgrade-render test to supply an explicitly tested image. Keep a separate negative test proving an unpinned upgrade is rejected.

[View failed GitHub Actions job](https://github.com/opsknight-labs/OpsKnight/actions/runs/38288835659/job/114943731325)

The same job successfully completed its initial Compose validation and Helm lint before hitting that failure. Later deployment validations were skipped because the job stopped there.

## 3. Additional security/correctness gap found

P1 — Existing linked OIDC users need stronger registration-change protection during concurrent sign-in.

In [`oidc-identity-resolution.ts`](https://github.com/opsknight-labs/OpsKnight/blob/bb36e2e374c1d00042f10ccf72df6a2ffcaa6181/src/lib/oidc-identity-resolution.ts), users whose issuer/subject identity is already linked take an early-return path.

The newer `requireCurrentRegistration` check—which locks policy state and verifies the active provider version—runs later, inside the first-link/JIT transaction. That means this particular check does not cover already-linked identities.

The initial callback checks provider freshness, but a concurrent configuration change can occur after that check and before the sign-in handler updates the user's role or profile.

Possible consequence: A callback initiated under an old provider revision could apply stale role/profile claims during a provider change. This is a race-condition risk, not a demonstrated account takeover.

Required fix: Enforce the active-provider/version check on the already-linked identity path too, and protect role/profile synchronization against concurrent provider activation. Add a test where rotation occurs between the initial callback check and the account update; assert that no stale role or profile changes persist.

This matters especially because your existing SSO users already have linked identities—they are precisely the users taking this fast path.

## 4. Complete assessment from the beginning of our conversation

We started with one objective: make OpsKnight SSO world-class without damaging existing working installations.

Here's where that stands today.

| Area                                   | Assessment              | Remaining concern                     |
| -------------------------------------- | ----------------------- | ------------------------------------- |
| Initial `/setup` administrator         | Good                    | Live upgrade verification             |
| Existing SSO interoperability          | Good                    | Concurrent provider-change race above |
| User account linking                   | Good                    | Real-provider testing                 |
| SSO Required enforcement               | Strong foundation       | HA and failure certification          |
| Emergency-account isolation            | Strong foundation       | Physical hardware and custody drills  |
| Emergency recovery                     | Good                    | Real outage testing                   |
| Password and session policies          | Good                    | Performance under concurrency         |
| Administrator UI                       | Functional and improved | Final usability/accessibility testing |
| Audit and notifications                | Well structured         | Live email delivery and load testing  |
| PostgreSQL and deployment architecture | Sensible                | Actual Kubernetes cutover rehearsal   |
| 2.1 documentation                      | Substantially complete  | Tested operational evidence           |
| CI                                     | Not green               | Helm upgrade-render failure           |

### First administrator and emergency access

Our original decision is correctly reflected in the new architecture.

The first administrator remains a regular `User`, retaining their User ID and operational records. Successful SSO linking attaches the external identity to that account; it does not create a replacement administrator.

The emergency identities are stored separately, have independent WebAuthn credentials, and use a recovery-only session. They do not become normal responders or SCIM users.

This aspect of the plan has been implemented correctly at the architectural level.

### Personal versus system settings

The separation we agreed on is preserved:

- `Settings → Security` remains personal account security.
- `Settings → System → SSO / Authentication` is administrator-controlled.
- `Settings → System → Emergency Access` manages recovery identities.

The new console supports provider revision testing, role configuration, authentication policies, emergency enrollment, recovery, and diagnostics.

One small UI gap remains in personal Security: a session method that is missing or unrecognized can be displayed as Password rather than Unknown. It should never imply a method that the session has not proved.

### Existing SSO upgrade compatibility

The branch now includes a particularly valuable improvement: a repeatable upgrade harness that starts with an older OpsKnight database and tests the migration.

It verifies the original administrator, existing provider ciphertext, linked OIDC identity, team membership, incident history, and a pre-upgrade session. It also tests Optional/Required behavior, break-glass import, Entra missing `email_verified`, and provider rotation.

That is meaningful progress.

One additional improvement is warranted: the harness uses baseline commit `ea38c8c`, whereas the published `v2.0.0` release points to `097f491`. I compared them: the baseline is 16 commits newer, although there are no Prisma schema or migration changes between those points. For exact release traceability, I would run the same upgrade harness directly from the `v2.0.0` tagged release as well.

### Recovery and fault tolerance

Several previously identified issues are now addressed:

- Compromised-key revocation supports a degraded-recovery state.
- Anonymous authentication failures use distributed limits and aggregated alerts.
- Emergency-session mutations recheck the rotated capability.
- Stale recovery cookies no longer automatically override an authenticated normal admin.
- Password restoration can target one administrator for one hour rather than enabling everyone's passwords.
- A pinned recovery origin supports controlled hostname repair.
- Large session-count previews use database counts rather than loading all session metadata.

These are good changes. What remains is proof under real outages, including expired client secrets, IdP unavailability, database interruptions, failed notification delivery, and lost hardware keys.

## 5. Small gaps and engineering improvements

| Priority | Item                                        | Recommendation                                                                                           |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1       | Existing linked-identity rotation race      | Revalidate provider revision under the same security boundary as role/profile updates                    |
| P1       | Failing deployment CI                       | Update positive Helm upgrade tests and retain the rejection test for missing explicit images             |
| P1       | Production cutover not exercised            | Rehearse stop-all → migrate-once → start-new with actual Kubernetes resources                            |
| P1       | Real IdP compatibility remains unverified   | Test Entra first, then Google, Okta, Auth0, and supported custom OIDC                                    |
| P2       | Authentication-path database load           | Benchmark fresh policy and provider reads under realistic login/API concurrency                          |
| P2       | Exact released-version upgrade traceability | Run migration certification from `v2.0.0`, not only a later main commit                                  |
| P2       | Personal session-method fallback            | Display Unknown when the method is absent                                                                |
| P2       | UI maintainability                          | Continue extracting the 1,300+-line authentication console into focused components                       |
| P2       | Documentation evidence                      | Add verified failure screenshots, real-provider results, recovery drill records, and deployment outcomes |

I also recommend ensuring SCIM deprovisioning, ordinary API-key authentication, mobile sessions, and notification integrations continue working across SSO policy transitions. They are adjacent systems that could be affected indirectly even though their core implementations are not being redesigned.

## 6. Final release certification

Before treating the feature as ready, run this final sequence:

1. Correct the linked-identity race and failing CI, then update the branch with the latest `main` changes and rerun regression tests.
2. Rehearse an actual existing SSO installation upgrade, retaining encryption keys and identity records.
3. Verify live Microsoft Entra sign-in, including the original administrator, existing identities, role mappings, logout, expiration, JIT, and SCIM behavior. Repeat for the other supported providers.
4. Test two physical emergency hardware keys with separate custodians and exercise credential compromise, replacement, recovery, and access expiry.
5. Run an actual Kind/Helm controlled cutover, including failed migration recovery and a tested rollback strategy.
6. Load-test authentication and audit pipelines, especially database connection usage, session checks, provider rotation, and failure aggregation.
7. Walk through the 2.1 guides exactly as written, correcting anything that a new administrator cannot reproduce.

These are acceptance tests, not claims that I have already executed them.

## 7. Final scores

Architecture

# 8.5/10

Security design

# 8/10

Existing SSO compatibility

# 8.5/10

Administration UX

# 7.5/10

2.1 documentation

# 8/10

Production readiness

# 7/10

Qualitative source-review scores, not independently certified benchmarks.

Final merge decision: NOT YET.

The feature is substantially developed and aligns well with our original plan. I see no evidence that an ordinary existing SSO installation is inherently broken by the upgrade, and the new regression tests materially reduce that risk.

The two immediate code tasks are fixing the failing deployment workflow and closing the linked-identity provider-rotation race. After that, the remaining barrier is real-world certification rather than a major architectural redesign.

I would preserve the existing implementation and harden it—not rewrite it.

[Review the latest Enterprise SSO branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)