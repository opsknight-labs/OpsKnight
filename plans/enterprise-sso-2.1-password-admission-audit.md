## OpsKnight Enterprise SSO 2.1 — Latest review

Branch: `feat/enterprise-sso-2.1` · Verified HEAD: `2ce960a`

The password-or-hardware-key feature is now implemented, not just proposed.

I verified these changes in the code:

- When creating an emergency account, an administrator can choose Generated vault password or Hardware security key.
- Passwords are generated securely, displayed once, and stored as salted hashes in PostgreSQL—not as plaintext.
- Two independently verified recovery accounts can satisfy SSO Required, even if both use passwords.
- Password recovery uses the existing restricted `/recovery` session, rather than granting access to incidents or ordinary administration.
- Administrators can rotate passwords, change authentication methods, and disable accounts. Existing WebAuthn accounts remain compatible.
- The earlier notification-receipt problem has also received a follow-up fix for quarantined events.

CI: The latest authentication, published-release upgrade, emergency browser certification, and active deployment validation jobs have passed. Some older jobs appear as cancelled or skipped because newer runs superseded them; they are not failures of the latest completed checks.

## Remaining findings

I did not find a new confirmed P1 blocker in the selectable recovery implementation. Two areas are worth improving before calling it production-hardened.

| Priority          | Issue                                                                                                                                                                                                                                                       | Recommendation                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 — Availability | Password verification permits only two concurrent scrypt operations per application process. An attacker generating many login attempts from different IP addresses could occupy those slots and temporarily prevent legitimate emergency password sign-in. | Add ingress-level abuse protection and a distributed admission policy that preserves capacity for legitimate recovery attempts. Test a distributed attack against concurrent real recovery logins. |
| P3 — Usability    | With exactly two verified emergency identities under SSO Required, routine password rotation is blocked unless another identity has been verified or the administrator declares compromise.                                                                 | Explain this clearly in the UI. Consider a staged rotation flow so organizations can prepare a replacement without unnecessarily reducing recovery readiness.                                      |

The first issue matters because emergency login must remain usable when an organization is already experiencing an outage.

Sources: [password verification](https://github.com/opsknight-labs/OpsKnight/blob/2ce960aa8e4de6d6222b92b8812ceb568e31dca3/src/lib/auth-control/emergency-password.ts) · [emergency login and rate limits](https://github.com/opsknight-labs/OpsKnight/blob/2ce960aa8e4de6d6222b92b8812ceb568e31dca3/src/lib/auth-control/emergency.ts#L443-L558) · [credential rotation](https://github.com/opsknight-labs/OpsKnight/blob/2ce960aa8e4de6d6222b92b8812ceb568e31dca3/src/lib/auth-control/emergency-management.ts#L363-L430)

### Regression and certification evidence

# 347

Unit/component tests passed

# 111

PostgreSQL integration tests passed

# 12

Published-release upgrade tests passed

# 7

Browser tests passed, 2 intentionally skipped

The browser tests include password recovery in Chromium, Firefox, and WebKit. They verify the one-time secret display, restricted session, password reauthentication, rotation, and session revocation.

The 100,000-record notification-feedback benchmark also completed, with critical mail draining in its isolated PostgreSQL fixture. That addresses the earlier performance concern, although it is not a production capacity certificate.

## Final verdict

Implementation maturity

# 9/10

Production readiness

# 8.5/10

Recommendation: Ready for PR review; I would finish emergency-login abuse hardening before production rollout.

The major functionality you requested is now present, and the tests support the core behavior. Existing SSO and WebAuthn have been preserved rather than replaced.

The remaining external certification—real identity providers, physical keys, vault accessibility during SSO outages, and multi-node failure testing—is still important before treating Enterprise SSO 2.1 as fully production-certified.

[Review commit ](https://github.com/opsknight-labs/OpsKnight/commit/2ce960aa8e4de6d6222b92b8812ceb568e31dca3)[`2ce960a`](https://github.com/opsknight-labs/OpsKnight/commit/2ce960aa8e4de6d6222b92b8812ceb568e31dca3)