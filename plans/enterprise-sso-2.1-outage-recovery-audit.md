## OpsKnight Enterprise SSO 2.1 — New commit review

Reviewed commit: `edcf401` · October 14, 2026 · Compared against `088767b`

The new commit fixes all three issues from my previous audit. I reviewed the implementation and the new PostgreSQL failure-injection tests.

| Previous finding                                                   | Latest result                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| A bad provider receipt could block the shared notification queue   | Fixed — receipt failures are isolated, and core dispatch runs independently |
| A receipt replay error could make a successful send appear to fail | Fixed — fan-out accounting completes before post-send reconciliation        |
| Unmatched receipts could retry indefinitely                        | Fixed — bounded retries, quarantine states, and retention are implemented   |

The last fix matters beyond SSO: the notification queue also handles incident-related messages, so preventing receipt-processing failures from interrupting it is an important reliability improvement.

### Verified test results

# 332

Unit/component tests passed

# 95

PostgreSQL integration tests passed

# 6

New receipt-isolation tests passed

I verified these counts in GitHub Actions logs. The new tests cover deleted subscribers, lock contention, database-trigger failures, preserving successful notification sends, replay retry limits, and cleanup.

## 2. New finding — Valid receipts can be quarantined after a long outage

P2 — Recovery correctness

I found one remaining edge case in the new quarantine logic.

In [`notification-provider-feedback.ts`](https://github.com/opsknight-labs/OpsKnight/blob/edcf401a0c831429b9a3d21967c52848a665f894/src/lib/notification-provider-feedback.ts#L59-L72), a receipt is quarantined once it reaches 24 hours of age or exhausts its reconciliation attempts.

The age check happens before checking whether the notification can now be matched.

Consider this sequence:

1. An email is submitted successfully.
2. The delivery receipt is stored in PostgreSQL.
3. The notification worker is unavailable for more than 24 hours.
4. The worker recovers, with the notification and provider message ID now available.
5. The receipt is quarantined because it is old, without attempting the valid match.

The underlying email remains sent; the problem is that delivery confirmation and related feedback may never be reflected.

Fix: Attempt a valid, provider-matched reconciliation before applying the age-based quarantine rule. Use the age limit to stop repeatedly searching for unmatched records, not to discard immediately recoverable receipts.

Add a PostgreSQL test that simulates a 48-hour worker outage followed by recovery. This would make the new reconciliation behavior stronger.

## 3. Remaining operational limitations

| Priority     | Item                                                                               | Recommendation                                                                        |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| P2           | Receipt quarantine is visible mainly through PostgreSQL                            | Add a small operational metric for pending, retried, and quarantined receipts         |
| P2           | Twelve failures can quarantine valid receipts during prolonged database contention | Distinguish transient infrastructure failures from permanently invalid feedback       |
| Release gate | Actual IdP compatibility                                                           | Upgrade an existing deployment and test Microsoft Entra and other supported providers |
| Release gate | Physical WebAuthn keys                                                             | Exercise two independent custodians and compromised-key recovery                      |
| Release gate | Multi-node deployment                                                              | Certify actual split-runtime and multi-node failure recovery                          |
| Release gate | Real outbound providers                                                            | Verify receipt signatures, delivery callbacks, bounces, and provider failover         |

These are not evidence that normal SSO login is broken.

## 4. Latest CI status

At my final check:

| Workflow                      | Result  |
| ----------------------------- | ------- |
| Enterprise SSO authentication | Passed  |
| Published v2.0.0 upgrade      | Passed  |
| Deployment manifests          | Passed  |
| Swarm L0 validation           | Passed  |
| Runbook fault injection       | Passed  |
| Native Linux Agent            | Passed  |
| Swarm L1–L5                   | Running |
| Runbook browser matrix        | Running |

The authentication workflow includes the new six-test PostgreSQL isolation suite. The published-release upgrade job has also completed successfully.

[Review latest GitHub Actions checks](https://github.com/opsknight-labs/OpsKnight/commit/edcf401a0c831429b9a3d21967c52848a665f894/checks)

## 5. Final assessment

Architecture

# 9/10

Security implementation

# 9/10

Existing SSO compatibility

# 9/10

Production readiness

# 8.5/10

Qualitative source-review estimates, not independent production certifications.

### Merge verdict

Conditionally ready for merge after one focused correction and completion of CI.

I no longer see the previous shared-notification-queue blocker. The implementation now has meaningful failure isolation, bounded recovery, tested migrations, and substantial regression coverage.

I would make the receipt-age recovery correction, wait for all checks to pass, and merge without another architectural redesign.

Production rollout is a separate decision. Existing SSO compatibility looks strong in the published-release upgrade tests, but real IdP, physical-key, outbound-provider, and multi-node acceptance should still be completed before declaring Enterprise SSO 2.1 production-certified.

[View latest branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)