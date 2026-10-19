## OpsKnight Enterprise SSO 2.1 — Latest review

Branch: `feat/enterprise-sso-2.1` · Commit: `adeda2c` · October 13, 2026

The branch is improving, but I found one important flaw in the reliability certification itself.

### What is fixed

- Staged OIDC verification: Now rejects explicitly unverified email claims consistently with production login, while preserving existing linked-identity compatibility.
- Security-alert retries: Former administrators' alerts now receive terminal cancellation instead of retrying indefinitely.
- Alert retention: Completed and cancelled alert records are cleaned up after 90 days.
- Emergency endpoint protection: An optional NGINX rate-limiting configuration and automated edge test have been added.
- CI: Both dedicated Enterprise SSO jobs are passing, including the published-v2.0.0 upgrade regression suite.

### New finding — Database crash test gives misleading certification

P1 — Confirmed test defect

The fan-out crash test is supposed to terminate a PostgreSQL connection between inserting alerts and committing the transaction.

However, the actual GitHub Actions log contains:

```
ERROR: function pg_terminate_backend(bigint)
does not exist
```

The test calls `pg_terminate_backend(${pid})` through a parameterized query. PostgreSQL rejects the argument type before it can terminate the connection.

The test then passes because it expects any thrown error. Its certification report consequently says `actualDatabaseConnectionTerminated: true` without proving that the backend was terminated.

Required fix: Pass an integer-typed PID, verify that the targeted backend actually disappears, and make the test fail if the error is merely a SQL type mismatch. Then rerun the rollback, cursor-preservation, and concurrent-worker checks.

This does not prove the production fan-out implementation is broken. It means its connection-termination resilience test is not yet valid.

## 2. Two smaller issues still need work

| Priority | Finding                                                                                                                     | Required action                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P2       | Authentication-alert worker can keep retrying records whose underlying email notification has permanently failed or expired | Reconcile terminal delivery states, expose a failed-delivery status, and provide an explicit recovery/retry mechanism               |
| P2       | Generic OIDC allowed-domain checks have a remaining normalization inconsistency                                             | Apply the same verified-email normalization before organization-boundary validation in staged tests, claims preview, and production |

For the first issue, [`security-events.ts`](https://github.com/opsknight-labs/OpsKnight/blob/adeda2ccc5b295d7301be480bbbc80180366d213/src/lib/auth-control/security-events.ts#L140-L235) only marks alerts delivered when the underlying notification is `SENT` or `DELIVERED`. It doesn't distinguish a notification still retrying from one permanently `FAILED` or `SKIPPED`. Re-enqueueing the same notification key does not necessarily revive a terminal record.

For the second issue, production normalizes representations such as `"true"` into a boolean before evaluating the generic provider's domain boundary. The new staged flow normalizes the explicit rejection check but still passes raw claims to the organization-boundary validator. This is mainly a compatibility edge for providers returning nonstandard claim representations.

## 3. Full implementation status

| Area                                            | Assessment                           |
| ----------------------------------------------- | ------------------------------------ |
| Existing SSO preservation                       | Strong, published-upgrade CI passing |
| First administrator preservation                | Strong                               |
| Identity linking and role synchronization       | Strong                               |
| Authentication policy enforcement               | Strong                               |
| Independent WebAuthn emergency accounts         | Strong                               |
| Restricted emergency recovery                   | Strong                               |
| Staged provider configuration and activation    | Strong; minor parity gap             |
| Security events and notification durability     | Improved; terminal-delivery gap      |
| Admin UI separation and usability               | Substantially implemented            |
| PostgreSQL and session performance              | Local tests passing                  |
| 2.1 documentation                               | Substantially updated                |
| Live IdP and physical-key certification         | Outstanding                          |
| Multi-node HA and split-runtime failure testing | Outstanding                          |

The current commit is 13 commits ahead and 2 behind `main`. The branch's progress report says those older `main` patches were incorporated by cherry-pick, so the behind count alone is not evidence of missing functionality.

## 4. Latest GitHub CI

Enterprise SSO authentication

Passed

Published v2.0.0 upgrade

Passed

Native Linux Agent verification

Passed

Change detection

Passed

Deployment, Swarm, and Runbook matrix jobs were skipped on this commit. The authentication CI includes 281 passing unit/component tests, 58 passing database tests, and the NGINX edge fixture.

## 5. Merge decision

Architecture and implementation

# 9/10

Production readiness

# 8/10

Source-review estimates, not independent enterprise certifications.

My recommendation: HOLD for one more hardening pass.

The remaining code work is focused:

1. Correct the PostgreSQL crash-test parameter type and prove real connection termination.
2. Fix terminal email-delivery reconciliation.
3. Close the remaining claim-normalization inconsistency.
4. Rerun certification and update the corresponding `docs/v2.1.0` guides.
5. Complete real-provider, physical-security-key, and production-like HA acceptance before declaring enterprise readiness.

Regarding your main concern: I still see no evidence that the upgrade generally breaks existing working SSO. The dedicated published-release-upgrade tests continue to pass. I would preserve the current architecture rather than rewrite it.

[View latest branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)