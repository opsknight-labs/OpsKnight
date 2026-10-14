# OpsKnight 2.1 — Enterprise SSO redesign and implementation plan

Goal: Make SSO secure, easy to configure, resilient to identity-provider failures, and safe for existing OpsKnight installations. The implementation must include complete, manually maintained documentation under `docs/v2.1.0/`.

I checked the current implementation and 2.1 documentation. The plan below is intended as an implementation specification for the development team or Antigravity—not a claim that these changes are already implemented.

## 1. Final user experience

We will retain the existing settings structure:

| Location                                 | Purpose                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Settings → System → SSO / Authentication | Admin-only provider setup, authentication modes, access policies, provisioning, and diagnostics |
| Settings → System → Emergency Access     | Admin-only emergency-account enrollment, verification, recovery controls, and audit             |
| Settings → Security                      | Personal password, linked identity, and individual signed-in sessions                           |
| Users                                    | Normal employees, administrators, responders, and OIDC account-link approvals                   |

Emergency accounts should not be normal operational users. They should be visible in the protected Emergency Access administration screen, not in the regular responder/user-selection interfaces.

### The first administrator's journey

1. Initial installation: `/setup` creates the first administrator with a password.
2. Configure SSO: That administrator connects Microsoft Entra, Google, Okta, Auth0, or another supported OIDC provider. Normal password login remains enabled during testing.
3. Link the existing admin: The administrator completes a verified, explicitly authorized OIDC account-linking flow. The same OpsKnight user ID, records, and permissions are retained.
4. Test sign-in: The administrator signs in through SSO in a fresh browser session and confirms administrative access.
5. Prepare recovery: Two separate emergency identities are enrolled and tested using authentication independent of the IdP.
6. Enable SSO Required: The system validates readiness, switches the centralized policy, and revokes disallowed existing password sessions.
7. Daily operation: The original administrator uses SSO. Emergency accounts remain reserved for recovery.

Important: Enabling SSO must never delete, hide, or automatically convert the first administrator into an emergency account. Role mappings must also be checked before enforcement so the original administrator doesn't unexpectedly lose admin access.

## 2. Phase-by-phase implementation

### Phase 0 — Fix the existing security gaps

Priority: P0 — required before enabling UI-managed SSO enforcement.

The current implementation has working OIDC validation, role mapping, account linking, and session controls. But several behaviors must change:

- Existing password sessions must be re-evaluated when authentication policy changes, not only when the user next attempts to log in.
- Password creation, password changes, password resets, and invitation-based password onboarding must respect SSO Required.
- Emergency authentication must stop sharing the ordinary password session's Remember Me behavior.
- Password-based emergency sessions must never inherit the trusted-PWA 90-day option.
- Normal SSO sign-in must never silently fall back to password authentication if the provider is unavailable.
- All authentication paths, including direct API requests, must enforce the same policy.

Acceptance criteria: Enabling SSO Required blocks both new and existing ordinary password sessions; the emergency mechanism remains functional, short-lived, and independent.

### Phase 1 — Central authentication policy engine

Priority: P0.

Add a dedicated, versioned configuration record in PostgreSQL, rather than relying on deployment variables as the primary authentication policy.

Proposed model:

```
AuthenticationPolicy
  id
  mode                  PASSWORD_ONLY | SSO_OPTIONAL | SSO_REQUIRED
  version
  oidcConfigVersion
  enforcedAt
  lastVerifiedAt
  updatedBy
  updatedAt
```

Requirements:

- Central policy evaluator used by credential login, OIDC login, middleware/session validation, password operations, and account onboarding.
- Auth policy changes performed atomically using optimistic concurrency and audited transitions.
- All web replicas use the same authoritative database policy.
- Sessions carry an authentication-method indicator and policy version.
- High-risk authentication decisions read authoritative state rather than relying on potentially stale cache entries.
- Invalid/missing policy configuration fails closed, while explicitly supporting a documented bootstrap state.
- Existing `AUTH_LOCAL_LOGIN_ENABLED` and `AUTH_BREAK_GLASS_*` settings receive a one-time, backward-compatible migration, with warnings rather than silent changes.

Suggested API: one internal policy service such as `evaluateAuthenticationPolicy(action, principal, session)` to avoid different endpoints implementing different login rules.

### Phase 2 — Independent emergency access

Priority: P0.

I recommend dedicated emergency identities, rather than adding an ordinary user flag to the existing `User` model.

Proposed models:

```
EmergencyAccount
  id
  displayName
  status
  enrolledAt
  verifiedAt
  lastUsedAt
  credentialVersion

EmergencyCredential
  id
  emergencyAccountId
  credentialType
  publicCredentialData
  createdAt
  revokedAt

EmergencyAccessEvent
  id
  emergencyAccountId
  eventType
  outcome
  createdAt
  context
```

The emergency credential model should follow WebAuthn/passkey requirements. Never store private keys or plaintext recovery credentials.

Security rules:

- Require two independent active emergency accounts before allowing SSO Required.
- Prefer separate phishing-resistant hardware security keys, with resilient backup enrollment.
- No dependence on the external SSO provider.
- A separate `/login/emergency` page and separate session type.
- No Remember Me, no trusted-device extension, and no normal password-reset flow.
- Proposed default: 60-minute maximum session, 15-minute inactivity timeout.
- Rate limiting backed by shared PostgreSQL state, with safeguards against recovery-account denial of service.
- Mandatory audit and high-priority notification for every successful or failed emergency sign-in.
- Require fresh authentication before particularly sensitive recovery actions.

Access scope: Emergency accounts should access a restricted recovery console by default—repair SSO configuration, examine health, manage emergency credentials, and perform tightly controlled recovery operations—not the normal incident-response product.

That is safer than granting a seldom-used credential unrestricted day-to-day OpsKnight access.

Microsoft's emergency-access recommendations support independent accounts, strong authentication, auditing, and regular access drills.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://learn.microsoft.com\&sz=32)

Microsoft Learn



### Phase 3 — Guided SSO onboarding and enforcement

Priority: P1, following the security foundation.

Replace the long configuration-first experience with a setup wizard:

1. Select the identity provider.
2. Register the application's callback and add credentials.
3. Validate discovery, issuer, endpoints, token methods, and signing keys.
4. Perform a real browser-based test login, using a staged provider configuration.
5. Verify the existing first admin's identity and role.
6. Configure and test both emergency accounts.
7. Preview the consequences of enforcing SSO.
8. Confirm activation with fresh administrator authentication.

Important architecture requirement: New provider credentials must be testable without replacing the current working production configuration. Use staged revisions with explicit activation and rollback metadata.

Before activation, show administrators the number of password sessions that will be revoked, users requiring linking, and any missing recovery prerequisites.

The existing Test Connection operation remains useful, but it must not be labeled as proof of successful end-to-end login.

### Phase 4 — Redesign the admin UI

Priority: P1.

Keep the interface consistent with OpsKnight's existing design system. Avoid unnecessary badges, oversized cards, excessive decorative colors, and complicated nested navigation.

## SSO / Authentication

Proposed admin-only screen

Configured

Authentication policy

Choose how users sign in to this OpsKnight instance.

Password Only

SSO Optional

SSO Required

Preview only. Actual changes require verified readiness and administrator confirmation.

Connection

Microsoft Entra ID

Administrator sign-in test

Verified

Emergency recovery

2 accounts verified

Illustrative data; not actual OpsKnight configuration.

The page should have five clear sections:

| Section               | Contents                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| Overview              | Current mode, provider health, readiness, configuration activity              |
| Connection            | Provider templates, issuer, client credentials, callback URL, real login test |
| Access & provisioning | Allowed identities, JIT, SCIM, role mapping, user-linking readiness           |
| Authentication policy | Password/SSO mode, OIDC sessions, enforcement preview                         |
| Diagnostics           | Login failures, provider validation, last tested revision, relevant audits    |

Emergency Access should have its own admin-only screen within System, including emergency identity status, enrollment, authenticator management, drill history, and recovery events.

On phones, use a single-column layout with simple section navigation. No horizontal overflow or sticky controls that obscure the form.

### Phase 5 — Identity lifecycle, roles, and operational visibility

Priority: P1.

Enhance the existing implementation rather than replacing its stable OIDC identity model.

Identity linking and roles

- Preserve issuer-and-subject identity binding and explicit first-link approval.
- Add a preview showing whether an SSO login will link an existing account, provision a new account, or be rejected.
- Show the source of each user's role: manual, OIDC, or SCIM.
- Provide a sample-claims tester for role mapping.
- Warn before assigning `ADMIN` from broadly matching provider claims.
- Handle missing claims, Entra group overage, email changes, and issuer migrations explicitly.
- Keep emergency identities completely outside JIT and SCIM provisioning.

Sessions and auditing

- Display authentication method, session age, expiration, and revocation state.
- Support targeted session revocation after policy changes.
- Emit audit events for every policy transition, emergency enrollment, authentication failure, credential change, and recovery operation.
- Add actionable alerts for emergency sign-in and authentication-policy changes.
- Ensure the auditing system doesn't expose passwords, OIDC tokens, or credential secrets.

Provider reliability

- Distinguish discovery health from successful real login.
- Prevent one unavailable provider endpoint from causing unnecessary application-wide instability.
- Document stale metadata limits, signing-key rotation, and all failure responses.
- Consider OIDC back-channel logout as a later enhancement, where supported by the IdP; it is a separate mechanism from ordinary user-initiated logout.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://openid.net\&sz=32)

  OpenID Foundation



### Phase 6 — Compatibility and deployment safety

Priority: P0/P1 depending on the change.

OpsKnight already supports different deployment topologies. The new authentication architecture must work with all of them.

| Scenario                                    | Required behavior                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Existing installation using `.env` controls | Preserve its current effective login policy during migration                             |
| Fresh installation                          | Start with a secure, usable first-admin bootstrap                                        |
| Multiple web replicas                       | Share the same effective auth policy and revocation decisions                            |
| IdP outage                                  | No normal password fallback; tested emergency access remains available                   |
| PostgreSQL outage                           | Authentication fails safely; document external database recovery                         |
| Invalid OIDC configuration                  | Reject activation without destroying the last working configuration                      |
| Provider migration                          | Stage, test, and safely activate the new configuration                                   |
| Rollback to previous application version    | Explicit compatibility requirements; no assumption older code understands the new policy |

Use PostgreSQL, existing caches, and version checking. Redis is not required solely for this feature.

Also establish a strict `AUTH_LOCAL_LOGIN_ENABLED` and `AUTH_BREAK_GLASS_*` migration contract: no silent reinterpretation and no conflicting sources of truth.

## 3. Documentation implementation — OpsKnight 2.1

This is a required deliverable, not something to do after the code is finished.

The target is:

`docs/v2.1.0/`

I verified that this is the existing upcoming documentation tree. The current `docs/versions.json` still identifies v2.0.0 as released and v2.1.0 as upcoming.

### Documentation files to create

All paths below are relative to `docs/v2.1.0/`.

| File                                            | What it must explain                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guides/identity/authentication-modes.md`       | Password Only, SSO Optional, SSO Required; exact permitted and blocked actions; changing modes; effects on existing sessions                                           |
| `guides/identity/migrate-admin-to-sso.md`       | Full first-admin journey from `/setup`, linking the existing administrator, testing login, preserving account identity and permissions                                 |
| `guides/identity/configure-emergency-access.md` | Why emergency identities are separate, creating two accounts, authenticator enrollment, restrictions, verification, replacement, and disabling compromised credentials |
| `guides/identity/test-and-enforce-sso.md`       | Staged configuration, real login test, readiness checks, enforcement wizard, confirmation, and verification                                                            |
| `guides/identity/rotate-oidc-credentials.md`    | Client secret rotation, new provider configuration, issuer migration, expected session impacts, and safe recovery                                                      |
| `troubleshooting/login/sso-lockout-recovery.md` | Full lockout-recovery runbook, covering broken SSO, missing administrator access, emergency-account issues, and safe rollback                                          |
| `troubleshooting/login/emergency-access.md`     | Emergency sign-in failures, security-key issues, expired/revoked credentials, lockouts, and audit/notification failures                                                |

These are proposed new guides. They should only be published as supported procedures once the corresponding feature is implemented and tested.

### Existing documentation files to update

| Existing file                                | Required changes                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guides/identity/configure-oidc.md`          | Rewrite around the new UI flow, with supported provider-specific instructions, staged login verification, policy controls, and migration behavior |
| `guides/identity/configure-scim.md`          | Document emergency-identity exclusion, account authority, deactivation behavior, and session-revocation expectations                              |
| `guides/identity/README.md`                  | Add a clear identity setup journey linking the new guides                                                                                         |
| `concepts/authentication.md`                 | Explain authentication architecture, trust boundaries, emergency principals, policy versions, and session methods                                 |
| `troubleshooting/login/oidc-access.md`       | Expand diagnosis of linking, JIT, roles, account status, policy failures, and session invalidation                                                |
| `reference/configuration/README.md`          | Document current versus legacy environment variables, precedence, safe migration, defaults, and restart requirements                              |
| `start/initial-setup.md`                     | Explain what happens to the first administrator when SSO is introduced                                                                            |
| `guides/administration/settings-overview.md` | Distinguish System administration from personal Security settings                                                                                 |
| `guides/administration/manage-users.md`      | Explain account-linking states, JIT, and why emergency identities do not appear as regular users                                                  |
| `guides/administration/manage-sessions.md`   | Explain session methods, expiry, SSO enforcement, and personal versus admin revocation                                                            |
| `guides/administration/audit-logs.md`        | List real authentication-related audit events and how to investigate them                                                                         |

Also update the relevant guide indexes and navigation, without creating duplicate or conflicting instructions.

### The documentation standard for every new page

I would require every guide to contain the following:

1. Who needs this guide: administrator, operator, or user.
2. Prerequisites: roles, provider requirements, settings, required deployment secrets.
3. Exact UI navigation: real menu paths and visible labels.
4. Step-by-step actions: not a generic feature description.
5. Expected results: what should appear on-screen and what changes in the backend.
6. Verification: how to prove the setup works, ideally with a real login or recovery test.
7. Failure handling: actual error conditions with actionable troubleshooting.
8. Rollback: safe ways to return to the last working state.
9. Security implications: identity trust, active sessions, role changes, credential handling.
10. Source references: implemented code paths and tests supporting each claim.

For example, the first-admin migration guide should explicitly show:

```
Before SSO:
  Admin: admin@company.com
  Login method: Password
  Role: ADMIN

After successful account linking:
  Same OpsKnight user ID
  Login methods: Password + OIDC (optional mode)
  Role: ADMIN, subject to role policy

After SSO Required:
  Same OpsKnight user ID
  Login method: OIDC
  Ordinary password login: Blocked

Emergency recovery:
  Separate dedicated emergency identities
  Never automatically converted from the first admin
```

This example is critical because otherwise administrators may think SSO creates a replacement account or deletes the original.

### Provider-specific docs must remain detailed

Do not discard the existing useful instructions for Microsoft Entra, Google Workspace, Okta, Auth0, and Generic OIDC/Keycloak.

Each provider section should have a fully working configuration procedure with its actual issuer requirements, redirect URL, client authentication mode, requested scopes, claims, organizational boundaries, role mapping, and typical failures.

Ensure the wording remains implementation-accurate, particularly around Entra group overage, email verification, role-source ownership, session reauthentication, and SCIM deprovisioning.

### Documentation must follow the implementation

The rules I recommend:

- Human-maintained Markdown, not automatically generated end-user instructions.
- Update documentation in the same feature PRs that change the behavior.
- Retain existing 2.1 metadata/frontmatter conventions and verification evidence.
- Use screenshots of the real application after the UI exists; do not insert fabricated interface screenshots.
- Test internal links, routes, frontmatter, code/configuration references, and navigation.
- Extend the existing `tests/docs/tooling/v210-docs.test.mjs` checks and add v2.1-specific identity contracts. Do not weaken v2.0.0 documentation tests to accommodate new behavior.
- Avoid claims such as “automatic recovery,” “fully verified connection,” or “MFA supported” unless the code and test results prove them.

Website publication: Update the documents in the main OpsKnight repository only. Its existing docs-sync script copies released versions to the website; because v2.1.0 is currently upcoming, do not directly modify the website repository or publish the unfinished guides as released documentation.

## 4. Test and certification plan

The new system needs more than unit tests. It must pass realistic end-to-end flows.

| Area          | Tests required                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Bootstrap     | First administrator creation, login, account preservation                                            |
| OIDC          | Microsoft Entra, Google, Okta, Auth0, and supported custom-provider flows                            |
| Linking       | Same-account linking, expired approvals, wrong issuer, changed subject, email collisions             |
| Modes         | All three policies, transitions in both directions, blocked legacy password sessions                 |
| Emergency     | Enrollment, independent authentication, expiry, revocation, lost-key recovery, alerts                |
| Security      | CSRF, replay, state/nonce, unauthorized policy edits, rate limits, session fixation, role escalation |
| Availability  | IdP outage, database failure, metadata failure, concurrent admin changes                             |
| HA            | Integrated and split deployments, multiple replicas, restart and policy convergence                  |
| UI            | Desktop/mobile layouts, Safari/Chrome/Firefox, keyboard accessibility, form validation               |
| Documentation | Accuracy against code, live walkthroughs, links, correct 2.1 versioning                              |

Required failure cases: an admin must not be able to activate SSO Required with an unverified provider, no functioning SSO administrator, or insufficient recovery capability.

The test plan must also establish which existing sessions survive provider outages and how quickly session revocations take effect.

## 5. Recommended PR delivery order

Instead of one massive PR, split the work into manageable changes:

| PR | Scope                                                                     | Exit criteria                                                 |
| -- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1  | Authentication policy model, migration, backend evaluator                 | Modes enforced correctly and backward compatibility tested    |
| 2  | Session revocation and password-flow hardening                            | No password-policy bypasses                                   |
| 3  | Independent emergency identities, WebAuthn, restricted sessions           | Two tested recovery identities; emergency flows fully audited |
| 4  | Staged provider configuration, real sign-in testing, enforcement workflow | Cannot activate unsafe policy                                 |
| 5  | System SSO and Emergency Access UI redesign                               | Responsive and accessible admin workflows                     |
| 6  | Role/linking tools, provider health, audit/alert integration              | Complete diagnostics and operator visibility                  |
| 7  | End-to-end deployment certification and final 2.1 documentation review    | Tests pass, docs accurately describe shipped behavior         |

Each PR should include its relevant 2.1 documentation updates and regression tests. PR 7 is the final consistency and certification pass, not the first time documentation gets written.

## 6. Final acceptance criteria

Before considering this work complete, I want these guarantees:

- The original first administrator remains intact and can transition safely to SSO.
- SSO Required is genuinely enforced server-side, including on existing sessions.
- Two independent emergency accounts can restore access without the IdP.
- Emergency accounts cannot accidentally become normal incident responders or SCIM-managed users.
- Administrators cannot unintentionally lock themselves out through an ordinary UI change.
- Provider changes can be staged and tested without immediately breaking production login.
- The UI clearly separates personal account security from system-wide authentication administration.
- All supported deployment topologies behave consistently.
- Every feature and recovery procedure is correctly documented in `docs/v2.1.0/`.

My recommended sequence is: backend policy → session security → emergency recovery → safe rollout workflow → admin UI → full testing and docs certification.

The result should be a genuinely enterprise-ready authentication system, not just an improved SSO settings page.

## Selectable emergency authentication amendment — 2026-10-14

Independent recovery identities support `PASSWORD` or `WEBAUTHN`. Existing records retain
`WEBAUTHN`; normal Users, OIDC identities and sessions are not converted. Generated
passwords are returned once and stored as salted scrypt hashes. Two distinct active
identities, each drilled with its current configured method/origin in the preceding
90 days, satisfy the existing readiness requirement in any method combination.
Emergency password login grants only the restricted recovery capability and preserves
one-hour maximum, fifteen-minute idle and five-minute sensitive-write freshness limits.
Credential changes revoke existing sessions and readiness; required-mode guards and
explicit compromise handling apply to either method. There is no environment switch
or automatic fallback for normal SSO Required authentication.
