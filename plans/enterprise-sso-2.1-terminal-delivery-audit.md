# OpsKnight Enterprise SSO 2.1 — Latest deep audit

Branch: `feat/enterprise-sso-2.1` · Reviewed head: `fe601568` · October 13, 2026

The branch has improved again. All three issues from my previous review now have code changes and regression coverage. The two dedicated Enterprise SSO CI jobs are green.

However, I still wouldn't classify the implementation as fully production-certified. A few smaller reliability issues remain, alongside real-provider and deployment acceptance testing.

## 1. Previous issues — rechecked

| Earlier finding                                                          | Latest result                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| Missing `SystemSettings` breaks emergency origin repair                  | Fixed with transactional `upsert()`                |
| Already-throttled traffic generates excessive audit records              | Improved with aggregated throttling evidence       |
| Security-alert fan-out lacks crash-recovery testing                      | Tested with actual database connection termination |
| Staged SSO test rejects existing Entra identities without email          | Fixed in prior commit                              |
| Emergency login's shared global quota risks blocking legitimate recovery | Fixed in prior commit                              |
| Authentication certification CI failing                                  | Now passing                                        |
| Published 2.0.0 upgrade compatibility                                    | Dedicated CI passing                               |

### New resilience evidence

The latest committed test report records:

Throttled requests tested

# 3,000

3 durable audit samples; aggregate counter retained

Security alert recipients

# 1,201

Fan-out without reported duplicate alerts

Alert backlog recovered

# 240

Simulated 30-day delivery outage

CI upgrade verification

# Passed

Published-release-upgrade workflow

The tests now cover a terminated database connection during alert fan-out, preserved cursors, concurrent workers, removed recipients, and notification-backlog recovery.

These are meaningful fault-tolerance improvements. The report also correctly states that email transport was stubbed and that no live IdP or physical security key was used.

## 2. New issue found: staged SSO verification is less strict than production login

P1 — Confirmed policy inconsistency

This is the most important new finding in the code review.

The normal production OIDC sign-in rejects a token when the identity provider explicitly reports `email_verified=false`.

But the new staged administrator verification only applies that condition when creating a new identity link. An already-linked administrator can pass the staged test even when the token explicitly says the email is unverified.

That means a provider configuration could pass the administration wizard but subsequently fail during ordinary production login.

Fix: Apply the same explicit-unverified-email rejection to both paths. Continue allowing an absent email claim for an already-linked issuer/subject identity, which was the compatibility improvement added for Entra. Reuse the production claim-normalization logic rather than maintaining a separate interpretation.

Add signed-token regression tests for existing linked identities with `email_verified=false`, absent email, and provider-specific missing verification claims.

Source: [`src/lib/auth-control/oidc-revisions.ts`](https://github.com/opsknight-labs/OpsKnight/blob/fe60156856dca8b7aea67f4362c19d12044b0b7a/src/lib/auth-control/oidc-revisions.ts#L276-L315), compared with [`src/lib/auth.ts`](https://github.com/opsknight-labs/OpsKnight/blob/fe60156856dca8b7aea67f4362c19d12044b0b7a/src/lib/auth.ts#L929-L945).

## 3. Smaller gaps I found

| Priority | Finding                                                                         | Recommended fix                                                                                                        |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P2       | Removed administrators' email alerts are retried indefinitely                   | Add a terminal `SKIPPED`/`CANCELLED` state, rather than rescheduling every hour                                        |
| P2       | Throttled requests still update a shared PostgreSQL counter for every rejection | Benchmark sustained attack traffic and provide ingress-level protection                                                |
| P2       | Authentication alert records don't appear to have dedicated retention cleanup   | Add retention rules for completed alerts and terminal delivery records without losing required security audit evidence |
| P2       | The branch remains two commits behind `main`                                    | Integrate the latest runbook/agent changes carefully and rerun regression tests                                        |

### Alert delivery bug

I confirmed this in [`security-events.ts`](https://github.com/opsknight-labs/OpsKnight/blob/fe60156856dca8b7aea67f4362c19d12044b0b7a/src/lib/auth-control/security-events.ts#L164-L181).

When an alert recipient is no longer an active administrator, delivery is correctly skipped. But the alert stays pending, with another attempt scheduled an hour later.

That continues indefinitely. Over time, inactive-recipient records can accumulate and consume worker capacity.

The existing test checks that the removed administrator isn't notified, but doesn't check that retries stop permanently.

Fix: Introduce a terminal non-delivery status, update dashboard counts, and test that cancelled alerts are never retried.

### Residual abuse-resistance limitation

The new throttling design reduces 3,000 rejected requests to three durable audit samples. That's a meaningful improvement.

But `recordEmergencyThrottle()` still increments a PostgreSQL counter for every rejected request. An extremely high-volume attack can still cause database load even when individual audit events are suppressed.

This isn't a demonstrated outage. It's a reason to test ingress-level protection and database behavior under sustained abuse.

## 4. Overall implementation status

| Original objective                                        | Assessment                                          |
| --------------------------------------------------------- | --------------------------------------------------- |
| Preserve existing SSO                                     | Strong compatibility evidence                       |
| Preserve first administrator, identity, roles and history | Implemented and upgrade-tested                      |
| UI-controlled authentication policies                     | Implemented                                         |
| Secure SSO activation and provider rollback               | Implemented; one verification inconsistency remains |
| Independent WebAuthn emergency accounts                   | Implemented                                         |
| Restricted recovery console                               | Implemented                                         |
| Emergency session and credential security                 | Strong implementation                               |
| Fault tolerance and durable auditing                      | Significantly improved                              |
| Responsive admin-level UI                                 | Implemented with dedicated components               |
| Complete 2.1 documentation                                | Substantially implemented                           |
| Production upgrade and rollback                           | One-node Kind rehearsal completed                   |
| Live IdP, physical keys and multi-node HA                 | Not yet certified                                   |

### CI status

I rechecked GitHub after completing the source review.

Authentication certification — Passed

Published 2.0.0 upgrade — Passed

Runbook fault injection and browser matrix — Passed

Native Linux Agent verification — Passed

Deployment and Swarm validation were skipped on this commit because their workflow change detection did not select them; they are not fresh passes on this head.

## 5. Final assessment

Architecture

# 9/10

Security implementation

# 8.5/10

Existing SSO compatibility

# 9/10

Release readiness

# 8/10

Qualitative source-review assessments, not independent production certifications.

Merge verdict: HOLD for now, but the remaining code work is relatively focused.

My priority would be to fix the staged-versus-production email-verification inconsistency, permanently terminate ineligible alert deliveries, and add the corresponding tests and `docs/v2.1.0` updates.

After integrating `main`, I'd run the full certification workflow once more. The remaining external acceptance—live identity providers, physical hardware keys, and production-like multi-node testing—should be explicitly completed before claiming enterprise production certification.

Regarding your original concern: I found no evidence of a general regression that breaks existing SSO across the board. The published-release upgrade CI is green, and the original identity model remains intact. The staged-verification inconsistency is a real gap, though, so I wouldn't promise flawless SSO behavior yet.

[Review latest branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)