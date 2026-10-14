# OpsKnight Enterprise SSO 2.1 — Latest deep audit

Reviewed commit: `67148ab` · Branch: `feat/enterprise-sso-2.1` · October 13, 2026

Verdict: HOLD — not ready to merge yet.

The branch is now 9 commits ahead and 2 behind `main`. The previous staged-login compatibility issue and shared emergency-login rate-limit issue have both received substantial fixes. Existing SSO compatibility and local upgrade testing have also improved.

However, the new dedicated SSO certification workflow is failing, and I found another recovery-related edge case that needs correction.

## 1. Confirmed CI failure

Enterprise SSO / authentication — Failed

I checked the actual GitHub Actions logs.

Authentication database tests

1 failed

48 passed · 1 failed

Failing test

`repairs only the pinned database origin with fresh independent authority and preserves Required`

Error

```
NotFoundError: No SystemSettings found
Prisma P2025
```

The test expects `SystemSettings(id="default")` to already exist, but its fresh CI setup only explicitly seeds an administrator and authentication policy.

Fix: Initialize the required system-settings fixture before the recovery test, and add a separate test for installations where the settings row genuinely doesn't exist.

[View failing authentication CI job](https://github.com/opsknight-labs/OpsKnight/actions/runs/38392169149/job/115278367898)

The separate published-release-upgrade job passed, and deployment manifest validation also passed. These successes do not override the failing authentication check.

## 2. New commit fixes the CI failure

Enterprise SSO certification — Now passing

A new commit, `a7bc326`, landed during the audit. It initializes `SystemSettings` in the test fixture, and both dedicated CI jobs now pass:

- `authentication` — passed
- `published-release-upgrade` — passed

The earlier red authentication check is therefore resolved on the newest commit.

One underlying edge case still needs attention: actual installations can have no `SystemSettings` row if initial setup relied entirely on `NEXTAUTH_URL` or `NEXT_PUBLIC_APP_URL`. The emergency origin-repair implementation still uses `update()` rather than `upsert()`, so it can fail in that state. The new test fixture doesn't exercise this scenario.

Recommended fix: Support creation of the missing settings row during authorized emergency origin repair, and add a test that starts with no `SystemSettings` record.

## 3. Further issues found

### P2 — Excessive database writes during blocked emergency login attempts

In [`emergency.ts`](https://github.com/opsknight-labs/OpsKnight/blob/a7bc32642f7fa9357c7eb113fed7d82ce495ce90/src/lib/auth-control/emergency.ts#L89-L115), an IP exceeding its login-options limit is rejected, but the rejected request still calls `recordEmergencyFailure()`.

That function writes an emergency event and an audit record to PostgreSQL. Consequently, repeated requests that are already rate-limited can continue generating database writes.

Why it matters: Although the global recovery quota issue is fixed, high-volume unauthenticated traffic can still place pressure on PostgreSQL and the audit pipeline.

Recommendation: Preserve forensic evidence through aggregated rejection counters and bounded audit records, with perimeter request limits. Add a stress test using thousands of requests from already-throttled sources.

This is a potential resource-exhaustion issue, not a demonstrated production outage.

### P2 — Asynchronous security-alert delivery needs failure testing

The new [`security-events.ts`](https://github.com/opsknight-labs/OpsKnight/blob/a7bc32642f7fa9357c7eb113fed7d82ce495ce90/src/lib/auth-control/security-events.ts) implementation is materially better:

- First 100 administrator notifications are created synchronously.
- Additional recipients are processed in batches.
- PostgreSQL row locking prevents concurrent workers from processing the same batch.
- Notification intents survive worker restarts.

The branch records a successful 1,203-administrator concurrency test.

Remaining validation: Test a scheduler crash halfway through fan-out, a long notification-provider outage, changing administrator membership during delivery, and recovery of a large pending backlog.

### P2 — Upgrade compatibility still needs live customer-like acceptance

The branch preserves the existing OIDC callback architecture and has tests for existing users, identity links, sessions, and Entra compatibility.

However, the released-version upgrade harness uses representative fixture data. It does not prove compatibility with every historical configuration or every real identity provider.

Before production deployment, run an upgraded copy of the existing installation with its actual configuration and test the original administrator and ordinary users.

## 4. Previous issues: current resolution

| Previously reported problem                                            | Latest status                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Existing OIDC account could receive stale role updates during rotation | Fixed with registration locks and concurrency tests    |
| Staged SSO test rejected linked identities without email               | Fixed; existing binding can establish identity         |
| Shared recovery-login quota could block everyone                       | Fixed; ceremony and verification budgets are separated |
| Compromised emergency credentials couldn't be revoked safely           | Fixed with degraded-recovery handling                  |
| Excessive security-alert fan-out inside authentication transactions    | Improved with a durable asynchronous fan-out queue     |
| Legacy break-glass migration could disrupt Optional login              | Fixed with dedicated migration tests                   |
| Kubernetes deployment CI failed on unpinned Helm upgrades              | Fixed                                                  |
| Authentication certification CI failed on missing test settings        | Fixed in `a7bc326`                                     |
| Emergency origin repair when real settings row is absent               | Still open                                             |

These are genuine improvements. The older reports should not be treated as descriptions of the current code.

## 5. Performance results

The newest committed HTTP tests are better controlled than the earlier Kind measurements. They use warmup operations, three measurement rounds, and 500 requests per concurrency level.

Recorded p95 session-check latency across three local warmed test rounds.

Round 1Round 2Round 3

0 ms40 ms80 ms120 ms160 ms1102550

Reported local measurements from `enterprise-sso-2.1-http-steady-state.json`. One optimized web process, five database connections, local TLS proxy. Not production capacity certification.

All 6,000 measured HTTP requests passed according to the committed report.

Assessment: These results do not suggest an immediate authentication bottleneck at the tested concurrency levels. The variation at 50 concurrent requests should still be evaluated with a larger, sustained workload and realistic database contention.

## 6. Complete feature assessment

| Component                                     | Status                                  |
| --------------------------------------------- | --------------------------------------- |
| First administrator preservation              | Strong                                  |
| Existing SSO compatibility                    | Strong source/test evidence             |
| OIDC trust and identity linking               | Strong                                  |
| Role/claims mapping                           | Strong                                  |
| Password and session enforcement              | Strong                                  |
| Dedicated emergency identities                | Strong                                  |
| WebAuthn verification and session isolation   | Strong                                  |
| Emergency recovery availability               | Improved; missing-settings edge remains |
| Provider staging and activation               | Strong                                  |
| Administrator UI                              | Substantially implemented               |
| PostgreSQL fault tolerance                    | Locally tested                          |
| Kubernetes upgrades and rollback              | One-node Kind tested                    |
| Authentication performance                    | Initial measurements completed          |
| `docs/v2.1.0`                                 | Extensive implementation-based guides   |
| Live IdP and physical-key certification       | Not completed                           |
| Multi-node HA and split-runtime certification | Not completed                           |

## 7. What remains before merging

I would prioritize these actions:

1. Fix missing-`SystemSettings` emergency repair. Add real source-level support and tests, not just fixture initialization.
2. Bound audit writes for already-throttled unauthenticated requests, with regression and abuse tests.
3. Certify asynchronous alert fan-out recovery under scheduler crashes, outages, and recipient changes.
4. Reconcile the two newer `main` commits, particularly overlapping runbook and agent changes, and rerun affected CI.
5. Finish external acceptance: real IdP tenants, two independent hardware keys, production-like split deployment, and notification-provider delivery.

Keep the corresponding recovery and operations documentation updated in `docs/v2.1.0`.

## 8. Final rating

Architecture

# 9/10

Security implementation

# 8.5/10

Existing SSO compatibility

# 9/10

Production readiness

# 8/10

Qualitative assessments based on source inspection, test coverage, and available CI evidence—not independent production certification.

My final assessment: The Enterprise SSO branch is now mature at the architectural level. The initial administrator, existing OIDC identities, password controls, emergency recovery, and staged activation have substantial implementation and regression coverage.

I would not merge immediately, but I also don't see a reason to redesign the system again. The remaining work is focused hardening, fixing the missing-settings recovery edge, and completing operational certification.

The most reassuring result for your original concern is that the dedicated published-v2.0.0 upgrade CI is passing. Existing SSO is being preserved deliberately rather than replaced blindly.

[View the latest branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)