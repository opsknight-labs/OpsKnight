---
title: Choose an authentication mode
description: Understand database-backed login policy, permitted password operations, and policy-driven session revocation.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence:
    - src/lib/authentication-policy.ts
    - src/lib/authentication-policy-evaluator.ts
    - src/app/(app)/settings/system/authentication-actions.ts
    - src/components/settings/AuthenticationPolicySettings.tsx
    - tests/lib/authentication-policy.test.ts
    - tests/lib/authentication-policy-sessions.test.ts
    - tests/integration/authentication-policy-database.test.ts
---

# Choose an authentication mode

This guide is for administrators changing system-wide sign-in policy and operators
upgrading an existing installation. Personal password and session controls remain
in **Settings → Security**.

## Before you begin

Apply all application migrations to PostgreSQL. Every web replica must use the
same database and consistent deployment settings during the initial policy import.
Keep working administrator credentials available. OIDC requires the existing
encryption key, stable public HTTPS origin, client credentials, and provider
registration described in [Configure OIDC](configure-oidc/).

New **SSO Required** activation is currently unavailable. Dedicated WebAuthn
emergency identities and staged, real administrator login verification must be
implemented and certified before this restriction can be removed. Existing
installations with local login disabled retain their effective required policy
through the explicit legacy import; this does not certify their recovery readiness.

## What each mode permits

**Password Only** permits password sign-in, password creation/change, reset-token
issuance, invitation password onboarding, and password sessions. It rejects OIDC
sign-in and existing OIDC sessions, even when a provider configuration is saved.

**SSO Optional** permits both password and OIDC sign-in. Password operations remain
available. Existing account linking remains explicitly approved and bound to issuer
and subject. Saving a provider does not automatically change this policy.

**SSO Required** rejects ordinary password sign-in, password creation/change,
password resets, invitation-token issuance, and invitation password completion.
Existing ordinary password sessions are rejected at their next protected request.
OIDC sign-in remains available when the configured provider works. An IdP outage
does not enable normal password authentication.

An explicitly imported legacy emergency password identity remains a compatibility
exception for sign-in only. Password reset and creation are blocked for that identity
under SSO Required. It is still a regular User record in this intermediate
implementation; it is **not** a dedicated emergency principal or restricted recovery
console. Its sessions have a one-hour maximum, a 15-minute inactivity timeout, and
no Remember Me or Trusted PWA extension. Pre-upgrade emergency password sessions
must authenticate again to receive those restrictions.

## Change the mode

1. Sign out and sign in again as an active administrator. The confirmation must
   occur within five minutes of this sign-in; refreshing the session is insufficient.
2. Open **Settings → System → SSO / Authentication**.
3. In **Authentication policy**, select **Sign-in mode**. To select SSO Optional,
   first save and enable an OIDC provider in the connection form below it.
4. When changing to Password Only, enter **Verify your current password**. An
   administrator without a working local password cannot disable SSO this way.
5. Read the session-impact notice and select the acknowledgment checkbox.
6. Select **Change authentication policy**.

The current mode changes only after the server validates administrator permission,
fresh sign-in, rate limits, and the expected policy version. The database update
and `auth.policy.changed` audit event commit atomically. Concurrent edits require
the losing administrator to reload rather than overwriting the winner's policy.

Changing to Password Only revokes existing OIDC sessions. Changing back to Optional
does not resurrect those sessions: their immutable issuing-policy version remains
below the database revocation cutoff. Users must complete a new sign-in.

## Verify the result

Check the displayed current mode and the corresponding event in the audit log.
Use a separate browser session to test permitted login. In Password Only, attempt
OIDC login and verify it is rejected. When checking an imported Required policy,
test an ordinary password session created before migration and confirm a protected
request rejects it. Keep the administrator recovery session separate from this test.

Open event streams recheck policy during their authorization checks; ordinary
requests evaluate policy on each server session validation. The realtime heartbeat
checks at a 15-second interval; events and notifications check during their existing
polling cycles. This is not a promise of instantaneous closure of already-open streams.

## Failure handling and rollback

- **Sign in again**: perform a new full sign-in and retry within five minutes.
- **Policy changed elsewhere**: reload the page, inspect the current mode, and retry
  using the new version. Do not replay an old request.
- **Verify your current password**: verify the existing password; an SSO login alone
  is not proof that Password Only will leave you able to authenticate.
- **SSO Required activation is unavailable**: remain Optional. Do not bypass this
  restriction by editing the database to claim recovery readiness.
- **Provider edits while Required**: use a fresh administrator session to switch to
  Optional before editing the active provider. Staged activation is not available yet.
- **Database outage or missing migrated policy**: authentication fails closed.
  Restore PostgreSQL and its policy/import records through your external database
  recovery procedure. Environment-variable changes do not provide a bypass.

To undo an Optional/Password Only change, sign in using the currently permitted
method and repeat this procedure. Revoked sessions remain revoked. Rolling back
to application code that predates database policy is unsafe: older code uses the
legacy deployment controls. Review those controls and the database policy together
before any application downgrade; retain a database backup and a tested recovery path.

## Migration and security boundaries

On the first authentication-policy read, an advisory-locked transaction imports
`AUTH_LOCAL_LOGIN_ENABLED`, `AUTH_BREAK_GLASS_ENABLED`, and `AUTH_BREAK_GLASS_EMAIL`
once. Local login enabled plus an enabled OIDC configuration becomes Optional;
local login enabled without one becomes Password Only; local login disabled becomes
Required, even if the old provider configuration is broken. No user is converted,
deleted, or hidden during import. A warning and `auth.policy.migrated` event record
the migration. Subsequent environment edits do not change the database policy.

Password mutation transactions lock the same policy row as mode changes. A password
write that waits behind enforcement is denied after that change commits. A failed
policy lookup never falls back to ordinary local login. Do not treat a discovery
test as proof of administrator sign-in or recovery readiness.

## Implementation references

The policy/import models and both additive migrations are in `prisma/`.
`src/lib/authentication-policy-evaluator.ts` defines mode/action rules;
`src/lib/authentication-policy.ts` loads authoritative state and locks password
operations. `src/lib/auth.ts` enforces policy for login and session evaluation.
The source and database tests listed in this page's verification metadata cover
migration, stale sessions, outages, and transaction ordering. Their presence does
not claim a live provider or browser certification.
