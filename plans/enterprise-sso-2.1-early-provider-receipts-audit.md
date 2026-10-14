## OpsKnight Enterprise SSO 2.1 — Deep review

Latest verified commit: `38f3e58` · October 14, 2026

The latest push resolves both issues from my previous review:

- Claims preview now separates identity recognition from administrator readiness. An existing issuer/subject binding can be recognized while incomplete group claims still block administrator verification.
- Security-email reporting now distinguishes provider acceptance from confirmed delivery. The database, diagnostics UI, and provider-feedback handling have been updated accordingly.

I also verified that all nine GitHub checks on this commit have passed, including Enterprise SSO authentication, the published 2.0.0 upgrade suite, deployment manifests, Swarm, Runbook tests, and agent verification.

The branch is 16 commits ahead and two behind `main`. There is no open PR for this branch in the GitHub results I checked.

Overall finding so far: The core SSO architecture is mature, but I found a new delivery-receipt race that the current tests don't appear to cover.

## New finding 1 — Early provider receipts can be lost

P1 — Delivery-receipt reconciliation gap

The new receipt implementation handles a receipt arriving before an authentication alert is linked to an existing notification. That's useful, and there is a test for it.

But I found an earlier timing window:

1. OpsKnight submits an email to the provider.
2. The provider accepts it and immediately sends a delivery webhook.
3. The webhook is processed before OpsKnight saves the provider's message ID onto its `Notification` record.
4. The webhook event is stored, but no matching notification is found.
5. OpsKnight subsequently saves the message ID and marks the notification `SENT`.

I found no subsequent reconciliation that replays stored unmatched provider-feedback events. The notification may therefore remain Sent to provider even though a confirmed-delivery event exists in PostgreSQL.

This also affects early terminal bounce receipts.

Recommended fix: Reconcile stored provider events when the provider message ID is persisted, and periodically replay unmatched events using an indexed, bounded worker. Use provider identity plus message ID for correlation, with idempotent state transitions.

The required regression should send a provider callback before `Notification.providerMessageId` exists, then persist the provider result and verify that the final state is correct. The current early-receipt test begins after that message ID has already been stored.

Source: `src/lib/notification-provider-feedback.ts`, `src/lib/notification-control-plane.ts`, and the receipt integration tests.

## 2. Remaining findings

| Severity     | Finding                                                                                | Assessment                                               |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P1           | Provider receipt arrives before its message ID is stored                               | Confirmed gap in the reviewed reconciliation path        |
| P2           | Feedback webhook reads the full body before enforcing a size limit                     | Application-level resource-exhaustion risk               |
| P2           | Provider receipts are correlated by message ID without checking the provider identity  | Potential misattribution if provider message IDs overlap |
| Release gate | Real identity providers, physical keys, and production-like HA have not been certified | Not a demonstrated software defect                       |

### P2 — Feedback webhook needs an explicit request-size limit

The public feedback endpoint reads the entire request body with `await request.text()` before checking its HMAC signature.

That means an unauthenticated sender can make the application read and hash a large body before rejection. An ingress proxy may impose its own limit, but the handler itself does not.

Fix: Use a bounded raw-body reader, reject oversized requests before hashing, limit signature-header length, and add oversized-payload tests.

[Source: provider feedback route](https://github.com/opsknight-labs/OpsKnight/blob/38f3e58fe534800d19a1a486c6bbfda1afc193a1/src/app/api/webhooks/notifications/provider-feedback/route.ts#L15-L38)

### P2 — Match provider identity as well as message ID

The feedback event contains `provider` and `providerMessageId`, but the processing code looks up the notification using only `providerMessageId`.

The database currently makes that ID globally unique. This helps avoid ambiguous records, but it does not establish that the event came from the same provider that sent the message.

A mistaken or improperly mapped event could be attributed to the wrong provider's notification if identifiers overlap.

Fix: Validate the feedback provider against the recorded delivery attempt. Preserve compatibility with existing notification records during migration.

[Source: notification-provider-feedback.ts](https://github.com/opsknight-labs/OpsKnight/blob/38f3e58fe534800d19a1a486c6bbfda1afc193a1/src/lib/notification-provider-feedback.ts#L22-L68)

## 3. Comprehensive subsystem assessment

| Area                  | What I verified                                            | Result                                 |
| --------------------- | ---------------------------------------------------------- | -------------------------------------- |
| First administrator   | Original user and identity preserved across upgrade        | Strong                                 |
| Existing SSO          | Existing OIDC registration and linking behavior retained   | Strong                                 |
| Authentication policy | Database-controlled modes and server-side enforcement      | Strong                                 |
| Sessions              | Policy-version cutoffs, expiry and explicit revocation     | Strong                                 |
| OIDC staging          | Isolated revisions, real token tests and activation checks | Strong                                 |
| Account linking       | Issuer/subject binding and controlled first-link approval  | Strong                                 |
| Role mapping          | Group-overage handling and separate readiness reporting    | Improved                               |
| Emergency access      | Independent principals, WebAuthn, restricted sessions      | Strong                                 |
| Lockout recovery      | Provider repair, origin repair and password restoration    | Strong                                 |
| Authentication audit  | Transactional evidence and bounded administrator fan-out   | Strong                                 |
| Email delivery        | Authorization checks, retry control, receipt states        | Good; receipt race remains             |
| Administration UI     | Guided forms, diagnostics and responsive browser coverage  | Good                                   |
| Documentation         | 2.1 operator guides and test evidence                      | Good                                   |
| Deployment            | Controlled upgrade, rollback and manifest checks           | Good; production HA acceptance pending |

### Existing SSO: your original concern

The existing OIDC implementation has not been blindly replaced. Its stable identity model remains in use, while the new policy and provider-revision logic add enforcement around it.

The dedicated upgrade test runs from published OpsKnight v2.0.0 and checks compatibility with existing administrators, identities and sessions.

I did not find a new source-level regression in ordinary existing SSO login during this review. Still, the test environment does not substitute for signing into a live Microsoft Entra or Google tenant after upgrading a copy of an existing deployment.

## 4. Latest test evidence

GitHub workflow checks

9 / 9 passed

# 297

Authentication unit and component tests passed

# 80

PostgreSQL integration tests passed

# 12

Published-release upgrade tests passed

Counts independently checked in the latest GitHub Actions logs. Some logged errors arise from deliberate failure-injection tests; the jobs completed successfully.

The committed local browser report also records four passing tests across Chromium, Firefox and WebKit, with two intentional skips for virtual-authenticator cases outside Chromium.

The tests have become much more substantial. In particular, PostgreSQL termination testing now checks that the database backend was actually killed, rather than counting any SQL error as success.

## 5. What should be done next

I would keep the remaining work focused:

1. Fix and test receipt-before-message-ID persistence. This is the most important new correctness gap.
2. Harden the feedback webhook. Add raw-body limits and provider-aware correlation.
3. Test receipt ordering thoroughly. Include duplicate deliveries, early bounces, callback replay, provider failover, and explicit retry generations.
4. Complete external acceptance. Use existing Microsoft/Google SSO accounts, independent physical WebAuthn keys, real email providers, and production-like integrated/split deployments.
5. Update `docs/v2.1.0` with verified behavior and any limitations observed during those tests.

Do not add another major feature or redesign the authentication console as part of this final hardening work.

## 6. Updated verdict

Architecture and implementation

# 9/10

Security design

# 9/10

Existing SSO compatibility evidence

# 9/10

Production release readiness

# 8/10

Source-review estimates, not independently certified security or reliability scores.

Merge recommendation: HOLD for the remaining receipt correction and release acceptance.

The branch is no longer missing its major planned SSO components. It has strong security architecture, substantial tests, green CI, and specific upgrade-preservation coverage.

What remains is a narrower but important distinction: the implementation is mature; its behavior across real providers, unexpected event ordering, physical recovery keys and production HA is not yet fully proven.

I would fix the receipt race, finish those acceptance tests, and avoid further architectural changes unless the tests reveal a new blocker.

[Inspect current Enterprise SSO branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)