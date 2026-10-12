---
title: Test and enforce SSO safely
description: Test and enforce SSO safely with staged configuration, explicit verification and audited recovery.
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

# Test and enforce SSO safely

For administrators enabling Required SSO and operators validating rollout.

## Prerequisites

Complete [administrator migration](migrate-admin-to-sso/) and [two independent emergency drills](configure-emergency-access/). Ensure active replicas share policy and consistent legacy settings. Assign a pilot and administrator at the provider; configure production and test callbacks, role/group claims, organization boundary and session limits.

## Stage, test and preview

1. Sign in within the five-minute freshness window. Open **Settings → System → SSO / Authentication**.
2. Configure **Connection**, **Access & provisioning** and session limits. Stage a revision; this performs discovery/JWKS health checks without changing production.
3. Select the exact revision. Select the existing administrator, explicitly approve first linking if needed, and run the administrator sign-in test. Authenticate through the real IdP redirect.
4. Return to the console. Discovery health and actual administrator verification must both succeed. Complete the test within five minutes; activation proof lasts 15 minutes.
5. Preview enforcement impact. Review affected password sessions, users requiring issuer bindings, verified emergency identities, administrator role retention and replica mismatches.
6. Choose **SSO Required**, confirm activation and activate the tested revision. Changed policy/config versions, disabled/demoted admins, expired proof and stale recovery drills reject the entire transaction.

## Verify the production result

In separate browsers, verify production SSO preserves the existing administrator and pilot identities. Confirm password sign-in and password reset/creation are blocked, old password sessions fail on protected requests, and SSO-only invitations create no password setup token. Test emergency sign-in with each custodian and confirm access is limited to recovery. Inspect Diagnostics, authentication audit events and in-app security alerts.

Role mappings use ordered claim rules. Avoid broadly matching ADMIN rules; the explicit warning acknowledgment does not make them safe. Resolve Entra group overage by configuring appropriate app-role/group claims. Claims preview uses an untrusted sample to explain mapping and identity decisions; it is not a signed-login proof.

## Failure and rollback

Do not bypass blockers with database edits. Stage and test a corrected revision while the old production revision remains live. Under Required, a repair activation must preserve Required. If the IdP is unavailable, use [lockout recovery](sso-lockout-recovery/); password fallback requires a separate explicit policy restoration. Previous credentials can be staged as a new rollback revision and must pass a fresh real test before activation. Audit and alert failures roll back production mutations.
