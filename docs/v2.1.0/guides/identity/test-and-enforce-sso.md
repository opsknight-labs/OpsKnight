---
title: Test and enforce SSO safely
description: Test and enforce SSO safely with staged configuration, explicit verification and audited recovery.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-13
  evidence:
    - src/components/settings/AuthenticationConsole.tsx
    - src/lib/auth-control
    - tests/integration/emergency-authentication-database.test.ts
---

# Test and enforce SSO safely

For administrators enabling Required SSO and operators validating rollout.

## Prerequisites

Complete [administrator migration](migrate-admin-to-sso/) and [two independent emergency drills](configure-emergency-access/). Ensure active replicas share policy and consistent legacy settings. Assign a pilot and administrator at the provider; configure production and test callbacks, role/group claims, organization boundary and session limits.

## Stage, test and preview

1. Make sure you signed in within the last two hours. Open **Settings → System → SSO / Authentication**.
2. Configure **Connection**, **Access & provisioning** and session limits. Stage a revision; this performs discovery/JWKS health checks without changing production.
3. Select the exact revision. Select the existing administrator. If that administrator has no identity for this provider or app registration yet, tick **Allow this SSO identity to link to the selected existing OpsKnight administrator**; this consent applies to that one test only, and a retest never reuses it. Run the administrator sign-in test and authenticate through the real IdP redirect.
4. The result page shows only what the server recorded for this browser's test, then returns you to the revision. Discovery health and actual administrator verification must both succeed. Complete the provider sign-in within five minutes; the resulting proof lasts seven days.
5. Preview enforcement impact. Review affected password sessions, users requiring issuer bindings, verified emergency identities, administrator role retention and replica mismatches.
6. Choose **SSO Required**, confirm activation and activate the tested revision. Changed policy/config versions, disabled/demoted admins, expired proof and stale recovery drills reject the entire transaction.

## Verify the production result

In separate browsers, verify production SSO preserves the existing administrator and pilot identities. Confirm password sign-in and password reset/creation are blocked, old password sessions fail on protected requests, and SSO-only invitations create no password setup token. Test emergency sign-in with each custodian and confirm access is limited to recovery. Inspect Diagnostics, authentication audit events and in-app security alerts.

Role mappings use ordered claim rules. Avoid broadly matching ADMIN rules; the explicit warning acknowledgment does not make them safe. Resolve Entra group overage by configuring appropriate app-role/group claims. Claims preview uses an untrusted sample to explain mapping and identity decisions; it is not a signed-login proof.

## Failure and rollback

Do not bypass blockers with database edits. Stage and test a corrected revision while the old production revision remains live. Under Required, a repair activation must preserve Required. If the IdP is unavailable, use [lockout recovery](sso-lockout-recovery/); password fallback requires a separate explicit policy restoration. Previous credentials can be staged as a new rollback revision and must pass a fresh real test before activation. Audit and alert failures roll back production mutations.

## Deployment-specific preflight

Check the externally visible HTTPS origin and both callback URLs through the real
reverse proxy. Web replicas must agree on NEXTAUTH_URL, NEXT_PUBLIC_APP_URL, any
recovery pin, and the authoritative database. Apply additive migrations before
rolling out code that reads new fields; do not mix older/newer authentication code
in a release that changes policy semantics. Preserve encryption keys across rollout.

Discovery verifies endpoint shape; the administrator test exercises authorization
code exchange, PKCE, nonce, signed ID token/JWKS, email assurance, role mapping, and
existing identity ownership. A test does not issue an ordinary production session.
The proof is bound to revision, current provider version, selected administrator
security state, canonical origin, and a seven-day lifetime. The console shows the
proof state computed by the same check activation uses: **Verified — expires on …**,
**Verification expired — retest**, **Configuration changed — retest**,
**Administrator must verify again**, or **Identity/provider verification invalid**.

## Timers at a glance

| Timer                         | Length     | What it controls                                                                                                                                                                       |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator freshness       | 2 hours    | Whether an existing valid session may perform privileged authentication changes. It never extends a session: revoked, expired or unauthorized sessions are rejected inside the window. |
| Emergency recovery step-up    | 5 minutes  | Sensitive operations in an emergency recovery session. Recovery sessions also keep their one-hour cap and 15-minute idle limit.                                                        |
| Administrator SSO proof       | 7 days     | How long a successful administrator test of a staged revision counts for activation, while provider, administrator and origin are unchanged.                                           |
| Sign-in test flow             | 5 minutes  | The OAuth/OIDC state, nonce, PKCE verifier and browser binding of one test. Single use.                                                                                                |
| Session idle/absolute timeout | Configured | How long users stay signed in; see [Configure OIDC](configure-oidc/).                                                                                                                  |

Enforcement preview counts registered password sessions in PostgreSQL using an
indexed expiry column. Legacy records without a typed expiry projection are counted
conservatively. Counts concern registered sessions, not every theoretical JWT that
may exist. Activation repeats authoritative readiness checks in its transaction;
a displayed preview does not reserve policy or guarantee a later activation.

## Expected blockers and responses

- Administrator proof absent/expired (older than seven days) or invalidated: repeat real sign-in for the selected revision.
- Active provider changed: stage against its new version and repeat the test.
- Fewer than two recovery drills: independently drill both identities at the
  configured recovery origin. Revocation/enrollment invalidates the old drill.
- Replica conflict: reconcile deployment variables and wait for fresh observations.
- ADMIN mapping lost: correct groups/roles and verify the intended account.
- Unsaved draft: stage the draft; tests always target immutable saved values.

## Acceptance under Required

From separate browsers, verify ordinary SSO succeeds, a previous password session
fails, and an unknown/unassigned identity cannot gain ADMIN. Verify both recovery
custodians can sign in and cannot view incidents using recovery-only sessions.
Rotate an emergency session token and confirm its old capability cannot perform a
later mutation. Confirm background reads do not extend the idle timer. Practice an
IdP outage and repaired staged activation without weakening Required.

Use native browsers and actual tenants for final deployment certification. Chromium
virtual keys and the local cryptographic fixture verify application/protocol behavior;
they do not establish independent physical custody or vendor-side deactivation.

## Existing identities without an email claim

An existing administrator's issuer/subject binding can prove ownership even when
Entra or another provider omits mutable email claims. Organization boundaries and
administrator role checks still apply. The staged test and claims preview preserve
that existing binding. Creating a new link requires explicit ownership approval and
matching email assurance under the provider policy; an absent email cannot create
a new administrator link. If an existing link is removed after testing, activation
fails and requires a fresh ownership test rather than recreating it silently.
