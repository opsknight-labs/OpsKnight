---
title: Recover from SSO lockout
description: Recover from SSO lockout with staged configuration, explicit verification and audited recovery.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence:
    - src/components/settings/AuthenticationConsole.tsx
    - src/lib/auth-control
    - tests/integration/emergency-authentication-database.test.ts
---

# Recover from SSO lockout

For security-key custodians and deployment operators during an IdP or provider-configuration failure.

## Before starting

Use the recorded public HTTPS origin and emergency account identifier. Ensure PostgreSQL is available, migrations are applied and the original encryption key remains present. Emergency Access is independent of the IdP but depends on PostgreSQL. Maintain an external database restore procedure; no application recovery credential can authenticate through a database outage.

## Repair while preserving Required

1. Open `/login/emergency`, enter the emergency identifier and verify the independent hardware key.
2. Confirm `/recovery` opens the restricted authentication console. No ordinary User or trusted-device session is created.
3. Reverify the key when prompted for the five-minute freshness limit. Stage corrected issuer/client/secret/claim settings. Production remains unchanged.
4. Select the existing active administrator, explicitly approve ownership for a new binding, and test the staged connection through the IdP.
5. Preview readiness and activate the tested revision as **SSO Required**. Both independent current drills must remain valid.
6. Verify normal administrator SSO in another browser, review alerts/audit events and sign out of recovery.

## Deliberately restore password access

If the IdP cannot be restored, a fresh emergency principal can use **Restore password access** in `/recovery`. Select an existing active administrator, set a strong recovery password, and explicitly confirm restoration. This transaction changes policy to Password Only, preserves that User ID, rotates its password/token version, revokes prior method sessions and retires the legacy password bridge. An imported legacy recovery principal can restore only its own original administrator.

Sign in through ordinary password login in a separate browser. Review the policy change and security alerts, repair the IdP, repeat administrator verification and independent drills, and deliberately re-enforce SSO. This workflow enables ordinary password access by an explicit audited action; an IdP error never causes automatic fallback.

## Lost keys and database recovery

Use the other independently held identity or its backup key. Enroll replacements and drill before reducing readiness. If all keys are lost and the imported bridge has been retired, application-level recovery is unavailable: use the separately governed infrastructure/database recovery procedure and review every change. Do not delete import markers, enable legacy variables or claim the emergency subsystem works without its database.

Before downgrading application code, evaluate how the older version interprets environment login controls and existing password hashes. Preserve backups and security events. A restored snapshot can restore previously revoked state, so rotate credentials and sessions after restoring a backup. See [Emergency troubleshooting](../../troubleshooting/login/emergency-access/).
