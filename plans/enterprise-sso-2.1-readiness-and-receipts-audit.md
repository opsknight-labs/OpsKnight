## OpsKnight Enterprise SSO 2.1 — Latest deep audit

Branch: `feat/enterprise-sso-2.1` · Reviewed commit: `5650274` · October 14, 2026

The latest push fixes all three issues I identified in the previous review. I verified the changes in the implementation, regression tests, and GitHub Actions logs.

| Previous issue                                            | Latest result                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Queued security email could reach a demoted administrator | Fixed — authorization is rechecked at queue processing and before provider dispatch |
| Diagnostics underestimated pending security-alert work    | Fixed — fan-out jobs and materialized emails now have separate counters             |
| Failed email retry closed the confirmation UI             | Fixed — confirmation stays open on failure                                          |
| Security delivery history showed only 20 records          | Fixed — status filters and keyset pagination are implemented                        |

### Confirmed test results

Enterprise SSO authentication

Passed

296 unit/component tests and 75 PostgreSQL integration tests passed in the hosted workflow.

Published v2.0.0 upgrade

Passed

12 migration and compatibility tests passed.

Deployment manifest validation

Passed

The branch is now 15 commits ahead and 2 behind `main`. The progress records indicate the two older `main` patches were already incorporated separately; I did not merge or modify anything.

## Additional findings from the deeper review

I found two smaller correctness and observability gaps that weren't part of the previous audit.

| Priority | Finding                                                                          | Why it matters                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2       | Claims preview can look successful despite group overage                         | An existing identity may display `EXISTING_IDENTITY` while the real staged administrator test rejects the same overage condition                 |
| P2       | Security-email delivery status treats provider acceptance as delivery completion | `SENT` or `DELIVERED` both mark the authentication alert's `deliveredAt` field, although `SENT` doesn't necessarily establish recipient delivery |

### 1. Claims-preview accuracy

In [`identityClaimsPreview()`](https://github.com/opsknight-labs/OpsKnight/blob/5650274a8547d2e5cca30bcda59ef17fed0a795a/src/lib/auth-control/dashboard.ts#L286-L359), the response can report `EXISTING_IDENTITY` when group claims are incomplete, with an accompanying warning.

But [`completeOidcRevisionTest()`](https://github.com/opsknight-labs/OpsKnight/blob/5650274a8547d2e5cca30bcda59ef17fed0a795a/src/lib/auth-control/oidc-revisions.ts) rejects group-overage claims for administrator activation.

This is not an authentication bypass. It's an inconsistent readiness presentation.

Fix: Keep identity matching separate from login and activation readiness. Display explicit results such as Identity recognized — administrator verification blocked by incomplete group claims. Add a parity test between preview and staged verification.

### 2. Security email status accuracy

The authentication-alert worker currently considers these notification statuses successful:

```
notification.status === 'SENT' ||
notification.status === 'DELIVERED'
```

That marks the alert's `deliveredAt` even when an email provider merely accepted the message.

Fix: Separate provider accepted and delivery confirmed in diagnostics. Where the provider cannot confirm final delivery, report Sent to provider, not Delivered.

This distinction matters for security alerts because administrators need reliable evidence of whether notifications were submitted or actually delivered.

## Existing SSO regression assessment

Your biggest concern from the beginning remains whether the new architecture could accidentally break working SSO.

| Existing behavior                       | Current assessment                   |
| --------------------------------------- | ------------------------------------ |
| Microsoft/Google OIDC sign-in structure | Preserved                            |
| Existing provider configuration         | Upgrade-tested                       |
| Original administrator and User ID      | Preserved and tested                 |
| Existing identity links                 | Preserved and tested                 |
| Existing sessions                       | Migration and policy tests passing   |
| Password-only and SSO-optional behavior | Covered by regressions               |
| SSO Required enforcement                | Covered by policy tests              |
| Concurrent provider rotation            | Covered by database regression tests |
| Real Microsoft/Google tenant sign-in    | Still needs external acceptance      |

I found no new code-level defect demonstrating that ordinary existing SSO logins will fail after upgrade. The published-release upgrade workflow remains an encouraging safeguard.

That is not a guarantee of compatibility with every real IdP configuration.

## What is still not certified

Source-level security and regression testing

Authentication, session policy, identity linking, WebAuthn logic, notification authorization, and published-release database upgrades have substantial coverage.

Local browser verification

The committed browser record reports four passing tests across Chromium, Firefox and WebKit, including desktop/mobile diagnostics, pagination, stale retry rejection, and virtual-key recovery. Two virtual-authenticator cases were intentionally skipped outside Chromium.

Real enterprise acceptance

Live Entra/Google/Okta/Auth0 sign-ins, independently held physical security keys, actual outbound mail delivery, and production-like multi-node/split-runtime outage testing remain outstanding.

The latest GitHub checks show the dedicated authentication, published-release upgrade, deployment validation, agent verification, and runbook fault-injection jobs passing. Swarm L1–L5 and the runbook browser matrix were still running at my final check, so I cannot call the entire commit's CI green yet.

## Final rating

Architecture and security design

# 9/10

Existing SSO compatibility

# 9/10

Administration UI

# 8.5/10

Production readiness

# 8/10

Qualitative source-review estimates, not independently certified security benchmarks.

My merge verdict: HOLD for final certification—not for another redesign.

The previous high-priority authorization and delivery issues are now fixed with meaningful test coverage. I would correct the two smaller accuracy gaps, require all checks to finish, then complete the real-provider and HA acceptance gates before signing off on Enterprise SSO 2.1.

The implementation is considerably more mature than when we started. The next milestone should be proving the system works in real deployments, rather than continuing to add features.

[Review latest branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)