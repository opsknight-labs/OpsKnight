---
title: Recover from SSO lockout
description: Recover from SSO lockout with staged configuration, explicit verification and audited recovery.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-14
  evidence:
    - src/components/settings/AuthenticationConsole.tsx
    - src/lib/auth-control
    - tests/integration/emergency-authentication-database.test.ts
---

# Recover from SSO lockout

For emergency-identity custodians and deployment operators during an IdP or provider-configuration failure.

## Before you begin

Use the recorded public HTTPS origin and emergency account identifier. Ensure PostgreSQL is available, migrations are applied and the original encryption key remains present. Emergency Access is independent of the IdP but depends on PostgreSQL. Maintain an external database restore procedure; no application recovery credential can authenticate through a database outage.

## Repair while preserving Required

1. Open `/login/emergency`, choose its configured recovery method, enter the emergency identifier and use the generated vault password or independent hardware key.
2. Confirm `/recovery` opens the restricted authentication console. No ordinary User or trusted-device session is created.
3. Reauthenticate with the configured recovery method when prompted for the five-minute freshness limit. Stage corrected issuer/client/secret/claim settings. Production remains unchanged.
4. Select the existing active administrator, explicitly approve ownership for a new binding, and test the staged connection through the IdP.
5. Preview readiness and activate the tested revision as **SSO Required**. Both independent current drills must remain valid.
6. Verify normal administrator SSO in another browser, review alerts/audit events and sign out of recovery.

## Deliberately restore password access

If the IdP cannot be restored, a fresh emergency principal can use **Restore password access** in `/recovery`. Select an existing active administrator, set a strong recovery password, and explicitly confirm restoration. The default **Only this administrator · one hour** preserves the SSO mode and other users’ OIDC sessions. It permits password login only for the selected stable User ID, rotates that administrator’s password/token version, revokes earlier password sessions and retires the legacy bridge. The exception expires on both login and protected-session checks. **Entire instance · Password Only** is a separate choice: it reactivates all existing local passwords and revokes prior OIDC sessions, with a distinct confirmation. An imported legacy recovery principal can restore only its own original administrator.

Sign in through ordinary password login in a separate browser. Review the policy change and security alerts, repair the IdP, repeat administrator verification and independent drills, and deliberately re-enforce SSO. This workflow enables ordinary password access by an explicit audited action; an IdP error never causes automatic fallback.

## Lost credentials and database recovery

Use the other independently held identity or its backup key. Enroll replacements and drill before reducing readiness. If all independent recovery credentials are lost and the imported bridge has been retired, application-level recovery is unavailable: use the separately governed infrastructure/database recovery procedure and review every change. Do not delete import markers, enable legacy variables or claim the emergency subsystem works without its database.

Before downgrading application code, evaluate how the older version interprets environment login controls and existing password hashes. Preserve backups and security events. A restored snapshot can restore previously revoked state, so rotate credentials and sessions after restoring a backup. See [Emergency troubleshooting](../../troubleshooting/login/emergency-access/).

## Recover from a conflicting application URL

The pin must be planned and drilled before an incident. It never disables CSRF,
WebAuthn origin validation, session expiry, or PostgreSQL authorization checks.

1. Verify the public ingress still reaches the trusted hostname on which the
   emergency keys were enrolled. Restore its TLS certificate/route externally if
   needed. A deployment pin does not create DNS or ingress routing.
2. Set `AUTH_RECOVERY_ORIGIN=https://ops.example.com` on each web replica. Use the
   recorded origin, with no path, query, fragment, userinfo, or alternate port.
3. Align `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` with that same origin. Restart web
   replicas. A deployment-variable conflict must be repaired outside the app;
   changing one database setting cannot fix divergent environment variables.
4. Open `/login/emergency` on the pinned origin and authenticate with an
   independent password or hardware key. Only recovery endpoints/static assets receive the pinned
   host-routing exception; incident and ordinary administration routes do not.
5. In **Emergency Access**, review the origin conflict and confirm **Repair pinned
   application URL**. This fresh-authentication operation changes only the database App URL,
   increments policy version, and emits `auth.recovery.origin.repaired`.
6. Wait for all active web observations to converge (approximately two minutes).
   Re-test normal SSO, independent drills, callback URLs, and alert links. Remove
   an incident-only pin only after canonical controls agree and a drill succeeds.

Compose: set `AUTH_RECOVERY_ORIGIN` in the deployment environment and recreate
web services. Helm: set `config.authRecoveryOrigin` in the release values and roll
out the chart. For split deployments, web replicas must agree; schedulers do not
serve recovery HTTP. Never place session cookies or private key material in values.

## One-administrator restoration acceptance

Record the original User ID and choose the administrator-only scope. After
restoration, independently verify the selected administrator can sign in, an
unrelated existing local password cannot sign in, and valid OIDC sessions for
other users remain allowed. Confirm the UI displays the one-hour exception’s
expiry. A token with Remember Me does not extend this policy exception. Repair and
stage the IdP before the hour ends; activating a tested revision clears the
exception. The original administrator’s assignments and audit references remain.

Use instance-wide Password Only only after explicitly assessing which existing
passwords will become usable. Confirm the separate scope, review the critical
policy event, and deliberately revoke/rotate credentials as your incident plan
requires. Do not present this as a routine password reset.

## Completion evidence

Save the incident identifier, actor/custodian, preserved User ID, policy versions,
revision ID, expected failure, successful normal SSO test, independent drill times,
and alert-delivery result. Never paste JWTs, authorization codes, client secrets,
or recovery cookies into the incident. Review sessions and replica diagnostics,
sign out of recovery, and verify a used/rotated cookie cannot mutate configuration.

## Repair an environment-only installation

An installation configured through `NEXTAUTH_URL` or `NEXT_PUBLIC_APP_URL` may have
no persisted system-settings row. Authorized **Repair canonical origin** creates
that row when absent, or updates only its application URL when present. Other
settings retain their database defaults or existing values. The operation still
requires a fresh independent emergency session, an explicit deployment-managed
`AUTH_RECOVERY_ORIGIN`, aligned public URL environment variables, and the expected
policy version. It preserves SSO Required and commits the settings change, policy
version and mandatory audit/alert together. Missing settings never grant authority
or trigger an automatic policy downgrade.

## Generated emergency password is lost or exposed

A generated password cannot be retrieved from the server. Use another freshly
authenticated recovery identity or administrator to rotate it in **Emergency Access**.
Store the replacement once in a separately accessible vault and repeat the independent
drill. Rotation and method changes immediately revoke that identity's existing sessions
and readiness. Under Required, drill enough replacement identities before reducing
coverage. Confirm compromise only when the credential is actually compromised; that
path revokes immediately and alerts administrators that recovery coverage is degraded.
A normal User password cannot authenticate an emergency identity.
