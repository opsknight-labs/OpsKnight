## Part 1 — Latest branch review

Branch: `feat/enterprise-sso-2.1` · Latest commit: `598daa6` · October 14, 2026

The new commit, `fix(notifications): recover valid receipts after extended outages`, addresses the receipt-recovery problem from my previous audit.

I verified three improvements in the code:

- A valid provider receipt is matched before its age is used to decide whether to quarantine it.
- Receipts affected by temporary database failures are retained for further recovery attempts instead of being permanently discarded.
- A database migration repairs previously quarantined receipts where matching provider evidence exists.

The commit also adds Prometheus metrics for pending, retried, and quarantined provider receipts.

Existing SSO has not been redesigned by this commit. The change is concentrated in notification reliability, database migration, monitoring, and tests. The authentication and published-v2.0.0 upgrade workflows have passed.

Your proposed password-based emergency recovery, however, is not implemented yet. The current emergency-account creation, authentication, and SSO Required readiness checks still assume hardware security keys.

## Part 2 — Remaining issues in the new commit

The previous major notification failures have been addressed. I found one remaining recovery edge case and one operational concern.

| Priority | Finding                                                                                                                | Impact                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2       | Previously quarantined unmatched receipts are not automatically reconsidered when their notification becomes available | Delivery confirmation or bounce evidence could remain stuck |
| P3       | The new Prometheus receipt counters perform exact counts over outstanding feedback records                             | Potential slow metric collection with very large backlogs   |

### P2 — Quarantined receipts can remain stuck

The new migration restores previously quarantined receipts. However, that repair runs only during the upgrade.

Consider an event that becomes quarantined because its provider message ID cannot be matched. If the corresponding notification becomes available after quarantine, the normal replay query excludes the event.

Fix: When a notification's provider message ID is committed, also consider previously quarantined receipts with reason `UNMATCHED_PROVIDER_MESSAGE`, provided both the provider and message ID match. Do not reopen invalid-event or deleted-recipient quarantines.

Add a test for this exact sequence:

Receipt arrives → unmatched → quarantined → notification appears → receipt successfully reconciled.

Sources: [feedback matching](https://github.com/opsknight-labs/OpsKnight/blob/598daa6b53a780a709ef8d81eeb939ca3f0d9445/src/lib/notification-provider-feedback.ts#L120-L139) and [replay selection](https://github.com/opsknight-labs/OpsKnight/blob/598daa6b53a780a709ef8d81eeb939ca3f0d9445/src/lib/notification-provider-feedback.ts#L284-L311).

### P3 — Monitor receipt-metrics query cost

The new `/api/metrics` collector computes exact pending/retried/quarantined counts from `NotificationProviderFeedback`.

This is not a demonstrated production bug, but large accumulated backlogs could increase database work. The existing two-second collector timeout and cache limit the effect.

Fix: Add a large-backlog PostgreSQL benchmark, inspect `EXPLAIN ANALYZE`, and verify that Prometheus scraping does not compete with critical notification delivery.

[Source: metrics collector](https://github.com/opsknight-labs/OpsKnight/blob/598daa6b53a780a709ef8d81eeb939ca3f0d9445/src/app/api/metrics/route.ts#L242-L256)

## Part 3 — Implementation plan: Password or Hardware Key

I recommend implementing this in the same SSO 2.1 branch, without replacing the WebAuthn architecture.

### Proposed final behavior

## Emergency Recovery Account

System Settings → SSO / Authentication → Emergency Access

Password recovery

Generate a strong secret and save it in an independent organizational vault.

Hardware security key

Register a physical WebAuthn key and verify it.

Setup flow

&#x20;Create recovery identity

&#x20;Generate and securely store password

&#x20;Complete independent login drill

Proposed UI. Password-based emergency identities are not implemented yet.

SSO Required would continue to require two independently verified emergency identities, but either could use a password or a hardware key.

For example, an organization could choose two passwords, two keys, or one of each.

## Detailed implementation sequence

1. Extend the database without breaking existing accounts

   Update `prisma/schema.prisma` to add an emergency authentication method (`PASSWORD` or `WEBAUTHN`) and a nullable password hash to `EmergencyAccount`.

   Existing emergency identities automatically retain `WEBAUTHN`. Do not change existing User IDs, OIDC identities, sessions, or incident records.

2. Extend emergency account creation

   Update `src/lib/auth-control/emergency-management.ts`.

   Allow the administrator to choose the method during account creation. For password accounts, generate a cryptographically random recovery password and display it once.

   Store only a salted password hash. Prefer Argon2id, benchmarked for supported deployment environments; OWASP also documents appropriately configured alternatives.&#x20;

   [image](https://www.google.com/s2/favicons?domain=https://cheatsheetseries.owasp.org\&sz=32)

   OWASP Cheat Sheet Series

3. Add independent password authentication

   Update `src/lib/auth-control/emergency.ts` and `/api/auth/emergency`.

   Add `passwordLogin` and `passwordReauth` actions with account-level and network-level rate limiting, generic failure messages, audit events, and shared PostgreSQL authorization checks.

   Passwords must authenticate only emergency identities—not normal users.

4. Reuse the existing recovery-session security

   Preserve the current restricted emergency cookie, one-hour maximum session lifetime, 15-minute idle timeout, and five-minute fresh-authentication requirement.

   Password rotation or account disablement must revoke existing recovery sessions immediately.

5. Update SSO Required readiness

   Modify `emergencyReadiness()` and `src/lib/auth-control/oidc-revisions.ts`.

   Readiness should require two distinct active emergency identities, each verified with its configured authentication method within the existing 90-day window.

   A newly created password must not count as ready until its custodian completes an independent sign-in drill.

6. Update the two user interfaces

   In `AuthenticationConsole.tsx`, provide method selection, password generation, one-time copy, rotation, revocation, and readiness status.

   In `EmergencyLogin.tsx`, show password or hardware-key authentication based on the recovery method, without exposing account existence to unauthenticated attackers.

   Keep the existing legacy-password bridge separate from the new account-password implementation.

7. Add safe credential rotation and method changes

   Support password rotation and changing an account from Password to WebAuthn or vice versa.

   Under SSO Required, do not disable a verified recovery method until enough alternative recovery identities have completed their drills. Allow explicitly confirmed compromise revocation with degraded-recovery alerts.

8. Extend audit, diagnostics and documentation

   Record method enrollment, successful and failed sign-ins, password rotation, disabling credentials, and recovery use—without logging secrets.

   Update the SSO 2.1 configuration, recovery, lockout, and upgrade documentation. No new environment-variable toggle should be needed for this feature.

9. Certify across all supported deployment modes

   Test Docker, Kubernetes/Helm, integrated and split runtime, database restart, concurrent logins, account disablement, credential rotation, and upgrades from v2.0.0.

   Specifically verify that password-based emergency authentication works during an IdP outage while ordinary password login remains disabled under SSO Required.

### Important design boundary

The password option must never be an automatic bypass for ordinary SSO Required authentication.

It should only open `/recovery`, just as hardware-key emergency authentication does today.

Also, a vault password is useful only if the organization can retrieve it during an SSO outage. NIST explicitly supports password managers and recommends rate limiting for password authentication.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://pages.nist.gov\&sz=32)

pages.nist.gov



## Final recommendation

Current SSO architecture

# 9/10

Current release readiness

# 8.5/10

Qualitative source-review estimates, not independent production certification.

At my final CI check, the authentication, published-release upgrade, deployment, agent, and relevant fault-injection jobs were successful. Two broader Swarm/browser jobs were still running.

My recommendation is to keep this branch open for one focused final feature: selectable emergency authentication.

Fix the remaining receipt edge case, implement password-or-key recovery without changing the normal User authentication model, and rerun the full certification.

This gives OpsKnight the simpler experience you're aiming for while preserving the security work already completed.

[Review the branch](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1)