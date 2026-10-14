## OpsKnight Enterprise SSO 2.1 — Latest audit

Branch: `feat/enterprise-sso-2.1` · Commit: `91c5802` · October 14, 2026

The latest push addresses all three issues from my previous review. I checked the actual implementation and regression tests, rather than relying on the branch's progress notes.

| Previous issue                                                              | Latest assessment                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL crash test was passing without actually terminating a connection | Fixed in the test: the PID is cast correctly, termination is acknowledged, and the backend's disappearance is checked |
| Permanently failed security emails were retried indefinitely                | Fixed: terminal failures are recorded separately, with an explicit administrator-controlled retry                     |
| Staged OIDC used different email-verification rules from production         | Fixed: normal login, staging, and claims preview share normalization logic                                            |

The branch is 14 commits ahead and 2 behind `main`. The two older `main` patches appear to have been incorporated through cherry-picks, so the history difference alone does not establish missing changes.

The architecture continues to preserve existing OIDC identities and the original administrator. I have not found evidence of a widespread existing-SSO regression.

## New finding: security alerts can outlive administrator access

P1 — Authorization gap in queued email delivery

The new authentication-alert worker checks that a recipient is still an active administrator before creating a central email notification.

However, once that notification is queued, the general notification delivery worker does not appear to recheck administrator status for authentication-security emails immediately before dispatch.

This creates a race:

1. A security alert is queued for an active administrator.
2. That user is demoted or deactivated.
3. The email remains in the central notification queue.
4. The worker can subsequently send the security alert to the former administrator.

I verified the absence of this specific check in the reviewed central delivery path. This is a source-level confidentiality risk, not a demonstrated live email leak.

Fix: For notifications with `sourceType='AUTHENTICATION'` and the security-alert template, revalidate the recipient's current administrator status just before delivery. Mark unauthorized pending notifications `SKIPPED`, and add a regression covering demotion between enqueue and dispatch.

This is separate from the newly fixed cancellation of alerts that have not yet been enqueued.

## 3. Additional UI and operational gaps

I also traced the administration console, diagnostics, retry workflow, policy enforcement, identity linking, and notification queues.

| Severity | Finding                                                       | Impact                                                                                    |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P2       | Pending security-email count excludes unfinished fan-out work | Dashboard can underreport the number of emails still awaiting processing                  |
| P3       | Failed manual email retry closes the confirmation UI          | Operators may need to reopen the retry flow even though the action failed                 |
| P3       | Security-alert delivery diagnostics remain limited            | Failed-alert list shows only the latest 20 records, without a dedicated paginated history |

### Inaccurate pending email count

[`authenticationDashboard()`](https://github.com/opsknight-labs/OpsKnight/blob/91c5802382702b08e313d9e7205e87b8b43a840d/src/lib/auth-control/dashboard.ts#L90-L102) counts pending `AuthenticationAlert` records, but not the remaining recipients in `AuthenticationAlertFanout`.

For example, when a security event targets 1,200 administrators, the first 100 notifications are materialized immediately, while the others wait for asynchronous fan-out.

The console can initially display 100 pending deliveries even though substantially more notification intents remain to be created.

Fix: Display separate metrics for pending fan-out jobs, materialized pending emails, failed deliveries, and completed deliveries. Avoid presenting one count as the total backlog.

### Retry UI behavior

The central console catches failures inside `perform()`, but the diagnostics component assumes the returned promise rejects on failure.

Consequently, the retry confirmation closes even when the server rejects the request.

Fix: Return an explicit success/failure result from `perform()` and only dismiss the confirmation after success.

## 4. Existing SSO and upgrade compatibility

This remains your most important requirement.

| Compatibility requirement                           | Current result                   |
| --------------------------------------------------- | -------------------------------- |
| Preserve existing OIDC provider settings            | Covered by upgrade tests         |
| Preserve original administrator ID                  | Covered                          |
| Preserve linked Microsoft/Google identities         | Covered at the database level    |
| Preserve roles, teams and incident history          | Covered                          |
| Existing sessions across a 2.0.0 upgrade            | Covered                          |
| Existing Entra identities with missing email claims | Regression tests added           |
| Provider rotation and concurrent user-role changes  | Database concurrency tests added |
| Real Microsoft Entra production login               | Not independently certified      |
| Real Google/Okta/Auth0 production login             | Not independently certified      |

The reviewed production sign-in still uses the established OIDC identity-resolution implementation. The new policy and registration checks sit around it rather than replacing the underlying identity model.

I have not found a confirmed general regression that would break existing SSO for all users. That is reassuring, but live identity-provider testing is still required to establish compatibility with actual tenant settings.

## 5. GitHub CI status

I checked the latest commit's workflow results and authentication job logs.

Enterprise SSO authentication

Passed

Published v2.0.0 upgrade

Passed

Deployment manifests

Passed

Swarm L0 validation

Passed

Swarm L1–L5 and Runbook matrices

Still running

The dedicated authentication job completed 283 unit/component tests and 69 PostgreSQL integration tests successfully. The published-release upgrade job completed another 12 tests.

I inspected the PostgreSQL crash-test code and CI results. The corrected test now verifies actual backend termination, not just a rejected SQL statement.

The full CI run had not completed at my final check, because unrelated Swarm and Runbook jobs were still running.

## 6. Production-readiness assessment

| Area                              | Grade  |
| --------------------------------- | ------ |
| Authentication architecture       | 9/10   |
| SSO policy enforcement            | 9/10   |
| Existing SSO compatibility        | 9/10   |
| Emergency recovery design         | 9/10   |
| Session management and revocation | 8.5/10 |
| Security-event delivery           | 8/10   |
| Administration UI                 | 8/10   |
| 2.1 documentation                 | 8.5/10 |
| Overall production readiness      | 8/10   |

Qualitative source-review ratings, not independently certified security or availability scores.

The 2.1 documentation covers the major supported workflows, but final acceptance evidence remains outstanding for physical security keys, live IdP tenants, outbound email delivery, and multi-node/split-runtime failure conditions.

## 7. My merge decision

HOLD for now—but the remaining implementation work is relatively small compared with what has already been built.

I recommend this final sequence:

1. Fix the queued-security-email authorization gap so demoted administrators cannot receive pending security notifications.
2. Correct diagnostics backlog counts and the failed-retry confirmation behavior.
3. Add regression tests for both fixes, including demotion after central notification enqueue.
4. Update the relevant `docs/v2.1.0` guides with the final behavior.
5. Rerun the complete authentication, released-version upgrade, deployment, and browser certification checks.
6. Complete live IdP, physical-key, and production-like HA acceptance before claiming enterprise certification.

Bottom line: OpsKnight's Enterprise SSO implementation is in strong shape, and the latest changes resolve the previous certification defects. I would preserve the architecture, fix the remaining notification authorization issue, and finish operational acceptance rather than redesigning anything substantial.

[Review current branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)