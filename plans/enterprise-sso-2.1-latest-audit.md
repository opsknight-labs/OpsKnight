## Deep audit update — latest branch

Reviewed head: `f7b6be1` · Three commits ahead of `main` · 113 changed files

The latest branch is substantially more complete than the version I reviewed earlier. It now includes dedicated emergency accounts, WebAuthn authentication, staged OIDC revisions, an authentication administration console, session controls, and expanded 2.1 documentation.

My current conclusion: the architecture is promising, but there are still security and operational edge cases worth fixing before calling it enterprise-ready.

Two particularly important findings from the latest code:

- Compromised emergency-key revocation: Under SSO Required, the credential-revocation logic can reject revocation of the final verified recovery identity, even when the operator declares that key compromised. Security policy should not force a known-compromised credential to remain valid; revocation should be possible with a clearly defined degraded-recovery state and urgent remediation.
- Security-alert amplification: An unauthenticated emergency login-options request for a nonexistent account creates a failure event, and that event generates in-app notifications and email intents for every active administrator. The IP rate limit helps, but repeated requests from distributed sources could flood security alerts and increase database load.

Both need targeted abuse and recovery tests.

## 3. Additional findings from the new implementation

I traced the recovery APIs, credential enrollment, WebAuthn verification, OIDC code exchange, policy transitions, security-event delivery, the administration UI, and the added integration tests.

The findings below refer to the latest branch, not the older `c5b2aaa` version.

| Severity                     | Finding                                                                                                                        | Evidence and recommended correction                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 — Recovery availability   | Conflicting canonical URLs block emergency authentication as well as SSO administration.                                       | `authenticationOrigin()` rejects conflicts, and every emergency POST calls the same check. If a hostname configuration error contributes to an SSO outage, the recovery mechanism may also become unusable. Provide a securely pinned recovery-origin procedure or explicit operator repair path; do not loosen CSRF/origin validation. |
| P1 — Compromised credentials | Revoking the last verified emergency identity is blocked even if its key is compromised.                                       | `emergency-management.ts`: distinguish voluntary reduction in recovery readiness from mandatory credential revocation after compromise. Permit secure revocation and enter an audited critical recovery-degraded state.                                                                                                                 |
| P1 — Abuse resistance        | Unknown emergency-account requests trigger security events and administrator alert fan-out.                                    | `emergency.ts` and `security-events.ts`: aggregate unauthenticated failures, add distributed abuse limits, and cap expensive notification creation. Keep individual auditable security evidence.                                                                                                                                        |
| P1 — Scalability             | Enforcement preview loads and parses every registered password-session record.                                                 | `oidc-revisions.ts`, `preview()`: replace unbounded `userDevice.findMany()` with bounded/aggregate counting. This also runs during activation transactions, making latency and lock duration important.                                                                                                                                 |
| P1 — Security operations     | Restoring Password Only enables ordinary password login instance-wide.                                                         | `recovery.ts`: the action is explicit and audited, but it can reactivate other existing local passwords. Consider a narrower administrator-only restoration mode before globally changing policy.                                                                                                                                       |
| P2 — Recovery session race   | Emergency token rotation is not independently revalidated by token hash in the later mutation lock.                            | `actor.ts`, `lockControlActor()`: retain and compare the presented session capability's hash so a previously validated request cannot use a token after concurrent rotation.                                                                                                                                                            |
| P2 — Authentication UX       | An invalid emergency cookie can prevent normal administrator access to the authentication console.                             | `getControlActor()` checks the emergency cookie first and throws when it is invalid, even if an ordinary admin session is valid. Clear/ignore stale recovery cookies when falling back to a separately authenticated admin.                                                                                                             |
| P2 — SSO invitations         | Password-free SSO invitations create an approval and return a URL but don't automatically send an invitation email.            | `sso-onboarding.ts` / `users/actions.ts`: integrate with the existing invitation-delivery workflow and report sent/failed/manual delivery accurately.                                                                                                                                                                                   |
| P2 — Self-hosting polish     | Security-alert emails contain a hardcoded `https://opsknight.com/` link.                                                       | `security-events.ts`: use the canonical configured instance URL, with proper escaping and safe URL validation.                                                                                                                                                                                                                          |
| P2 — UI state                | Selecting a different provider revision doesn't automatically load that revision's values into the editable form.              | `AuthenticationConsole.tsx`: synchronize the selected revision and displayed configuration, while clearly separating an editable draft from production.                                                                                                                                                                                 |
| P2 — Administration scale    | The user selector loads at most 500 accounts, while the recovery flow may require choosing an administrator outside that page. | `authenticationDashboard()`: provide a dedicated search/paginated administrator picker instead of assuming the selected admin is in the first 500 users.                                                                                                                                                                                |
| P2 — Documentation depth     | Several new 2.1 guides are only around 40–48 lines despite describing security-critical operations.                            | Expand deployment-specific verification, expected errors, precise recovery paths, screenshots, and manual drills. They are a useful starting point, not yet Kubernetes/Grafana-level operator documentation.                                                                                                                            |

### Important distinction

I confirmed these behaviors from the code. Some are direct correctness or UX defects; others are security-design risks that require targeted runtime testing to establish their precise impact. I have not demonstrated unauthorized access or exploited a vulnerability.

## 4. What is already substantially improved

The latest branch addresses several of the blockers from my previous audit:

| Capability                                            | Latest source assessment                  |
| ----------------------------------------------------- | ----------------------------------------- |
| PostgreSQL authentication policies                    | Implemented                               |
| Legacy environment migration                          | Implemented                               |
| Existing-session revocation                           | Implemented                               |
| Independent WebAuthn emergency accounts               | Implemented                               |
| Restricted emergency recovery sessions                | Implemented                               |
| Emergency credential enrollment and drills            | Implemented                               |
| Staged OIDC provider configuration                    | Implemented                               |
| Real OIDC code-exchange verification                  | Implemented                               |
| Recovery without automatically disabling SSO Required | Implemented                               |
| Original admin preservation                           | Implemented in the reviewed flows         |
| SSO-only onboarding                                   | Implemented, with invitation UX gap       |
| Admin authentication console                          | Implemented; polish and scale gaps remain |
| Dedicated 2.1 guides                                  | Added                                     |
| Live multi-provider enterprise certification          | Not completed                             |

This is a significant improvement. It is no longer merely a partial authentication-policy branch.

## 5. Testing assessment

The branch's progress report states that its full unit suite passed 5,685 tests and that 37 isolated PostgreSQL integration tests passed. I also inspected the integration-test names and coverage.

They include real cryptographic WebAuthn verification, staged OIDC token exchange, policy concurrency, emergency-session expiry, recovery, and database-backed authorization. This is useful evidence.

However, I did not independently execute the suite or reproduce the claimed browser results. The remaining certification should include:

- Actual Entra, Google, Okta, Auth0, and custom OIDC tenants.
- Two physically independent hardware keys, including loss and compromise scenarios.
- Integrated and split deployment tests with multiple web replicas.
- Hostname conflicts and emergency recovery during a broken IdP configuration.
- Large-session-count activation performance.
- Attack traffic against emergency authentication and alert queues.
- Native Safari, Chrome, Firefox, mobile and keyboard/screen-reader testing.

## 6. Fix order before merging

I would resolve the findings in this sequence:

1. Recovery availability: Canonical-origin conflicts, compromised-key revocation, and emergency recovery behavior under broken configuration.
2. Security controls: Rate-limit/alert amplification, emergency-session rotation races, and scoped password restoration.
3. Performance: Remove unbounded enforcement-preview reads and load-test security-event fan-out.
4. UX: Fix provider-revision editing, stale recovery-cookie handling, admin search, and SSO invitation delivery.
5. Documentation: Extend `docs/v2.1.0` with the actual recovered failure cases, tested procedures, and explicit limits.
6. Certification: Run live IdP, physical-key, cross-browser, and multi-replica acceptance tests.

## Final grade

Architecture and implementation

# 8/10

Source-review estimate

Enterprise release readiness

# 6.5/10

Pending fixes and live certification

Merge recommendation: Not yet. The architecture is in much better shape, and the major planned features now exist. I would address the recovery-safety and abuse-resistance issues first, then complete live certification before calling this a world-class enterprise SSO implementation.

You can review the exact branch here: [OpsKnight Enterprise SSO 2.1](https://github.com/opsknight-labs/OpsKnight/tree/feat/enterprise-sso-2.1).
