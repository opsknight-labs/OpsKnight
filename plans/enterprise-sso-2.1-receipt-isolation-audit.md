## OpsKnight Enterprise SSO 2.1 — Latest audit

Reviewed commit: `088767b` · October 14, 2026

The latest two commits address the three issues from my previous review:

| Previous finding                                    | Current result                                           |
| --------------------------------------------------- | -------------------------------------------------------- |
| Provider receipt arrives before message ID is saved | Fixed with durable unmatched receipts and reconciliation |
| Feedback webhook has no request-size limit          | Fixed with a 64 KB streaming limit                       |
| Feedback can be attributed to the wrong provider    | Fixed with recorded provider-identity matching           |

All nine GitHub checks are passing, including Enterprise SSO authentication, the published v2.0.0 upgrade tests, deployment validation, Swarm, Runbook, and agent verification.

I also confirmed that the receipt tests now cover callbacks arriving before the provider send returns, immediate and delayed reconciliation, historical data repair, and duplicate-event handling.

However, I found a new issue in the reconciliation worker that warrants attention before merging.

## New P1 finding — One bad receipt can interrupt the entire notification queue

I traced the new replay worker and found a cross-feature reliability risk.

The central notification processor now runs provider-feedback reconciliation before dispatching notifications of any category. If an individual feedback event throws an exception, the reconciliation loop stops and the central notification processor fails before reaching normal queue processing.

A concrete case exists in the code: a `SOFT_BOUNCE` receipt for a status-page subscriber whose subscription was deleted after the email was sent. The feedback processor calls `statusPageSubscription.update()`, which throws when that record no longer exists.

Because the event remains unprocessed, subsequent worker runs can encounter the same exception again.

Impact: An unrelated status-page feedback event could prevent the central worker from delivering incident notifications, authentication alerts, and other queued messages. This is particularly important for an incident-management product.

Required fix: Isolate reconciliation failures per receipt, classify permanently invalid records, apply bounded retry/dead-letter handling, and ensure receipt replay cannot block the core notification queue. Add a real PostgreSQL regression that deletes the subscription before a soft-bounce receipt and verifies critical notifications still drain.

Sources: [`notification-provider-feedback.ts`](https://github.com/opsknight-labs/OpsKnight/blob/088767bef1de1ccf82598963d481b548c69d3999/src/lib/notification-provider-feedback.ts) and [`notification-control-plane.ts`](https://github.com/opsknight-labs/OpsKnight/blob/088767bef1de1ccf82598963d481b548c69d3999/src/lib/notification-control-plane.ts#L2941-L2955).

This is the main reason I would still hold the merge, even though all CI checks are green.

## 2. Additional reliability issues

I found two smaller problems in the same new reconciliation flow.

| Priority | Finding                                                      | Impact                                                                                                                          |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| P2       | Reconciliation is awaited after successful provider dispatch | A feedback-processing failure can make a successfully sent notification appear to have failed, and interrupt fan-out accounting |
| P2       | Permanently unmatched provider events have no terminal state | Events with invalid or obsolete message IDs can be retried indefinitely, gradually increasing database work                     |

### Provider dispatch must not depend on receipt replay

In [`notification-control-plane.ts`](https://github.com/opsknight-labs/OpsKnight/blob/088767bef1de1ccf82598963d481b548c69d3999/src/lib/notification-control-plane.ts#L2549-L2567), the new reconciliation call happens after the notification has already been marked sent, but before `recordFanoutTerminal()` and the successful return.

If reconciliation throws, the notification can remain `SENT` while the delivery function rejects and fan-out accounting is skipped.

I would make receipt reconciliation independently fault-tolerant. Failure to replay feedback must never undo—or obscure—a provider submission that has already succeeded.

### Unmatched receipt lifecycle

The replay worker reschedules unmatched events one minute later, but has no maximum age, retry count, or dead-letter state.

Add bounded retries and terminal quarantine for events that can never match, while preserving searchable evidence. This is particularly important for deleted records and invalid provider IDs.

## 3. Overall SSO status

| Component                                        | Latest assessment                 |
| ------------------------------------------------ | --------------------------------- |
| Existing SSO compatibility                       | Strong regression coverage        |
| Original administrator preservation              | Verified by upgrade tests         |
| Authentication policy and session enforcement    | Strong                            |
| OIDC identity linking and staged activation      | Strong                            |
| Independent emergency WebAuthn access            | Strong                            |
| Recovery and fault tolerance                     | Strong local evidence             |
| System SSO administration UI                     | Substantially complete            |
| Audit and notification security                  | Strong, with replay isolation gap |
| Docker, Helm and Swarm validation                | Passing                           |
| 2.1 documentation                                | Substantially complete            |
| Real IdP, physical-key and multi-node acceptance | Outstanding                       |

The last two commits focus on notification receipts and their migrations. They do not substantially rewrite the established OIDC login or identity-linking implementation.

I still found no new general regression in existing working SSO. The published v2.0.0 upgrade checks remain green.

## 4. CI and certification

GitHub checks

9/9 passed

# 330

Unit/component tests passed

# 89

PostgreSQL tests passed

# 12

Release-upgrade tests passed

Verified from GitHub Actions logs. These do not include live IdP or production-scale certification.

## 5. Fix order

1. P1: Ensure one invalid provider-feedback event cannot stop the central notification queue.
2. P2: Decouple post-send reconciliation failures from successful provider submission and fan-out accounting.
3. P2: Add dead-letter and retention handling for permanently unmatched feedback.
4. Test all three using real PostgreSQL transactions, with a deleted subscription, failed replay, and valid critical notification waiting in the queue.
5. Rerun certification and update `docs/v2.1.0` before merge.

## Final verdict

Architecture

# 9/10

Production readiness

# 8/10

Qualitative source-review estimates, not independent production certification.

Merge: HOLD.

The Enterprise SSO implementation itself is mature, and the major planned capabilities are present. But the newly introduced receipt replay is now connected to OpsKnight's shared notification infrastructure. That makes the queue-isolation issue important enough to fix before merging.

After that, the remaining release gate is real-provider, physical-key and production-like HA certification—not another SSO redesign.

[View latest Enterprise SSO branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)