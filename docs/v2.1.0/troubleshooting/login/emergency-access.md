---
title: Troubleshoot emergency access
description: Diagnose hardware-key enrollment, drill, session and alert failures.
type: troubleshooting
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence:
    [src/lib/auth-control/emergency.ts, tests/integration/emergency-authentication-database.test.ts]
---

# Troubleshoot emergency access

For custodians using `/login/emergency` and administrators using **Settings → System → Emergency Access**. See [setup and custody](../../guides/identity/configure-emergency-access/) and [lockout recovery](../../guides/identity/sso-lockout-recovery/).

## Enrollment or sign-in fails

Use the recorded account identifier and an active independently held hardware key. Complete its PIN/user-verification ceremony. Synced passkeys are rejected. Verify HTTPS, the exact canonical origin and original RP hostname; reverse-proxy host changes and credentials enrolled on another hostname fail origin/RP verification. Request a new challenge after cancellation, expiry, browser changes or reuse. Challenges expire in five minutes and are bound to their initiating browser.

A counter rollback, revoked key or changed credential version rejects the signature. Do not reset stored counters to bypass verification. Use a backup key or second identity, investigate a possible clone and revoke the affected credential. Shared network limits expire without permanently locking the emergency account; retry after the limit window or use an authorized alternate network.

## Readiness disappears

Enrollment/revocation invalidates that identity's previous drill and all its sessions. Sign in again with a remaining active key. Disabled identities and drills older than 90 days do not count. Required activation needs two independently held ready identities; repeat drills after changes. A browser login test for SSO is separate from both hardware drills and discovery health.

## Session ends while the page stays open

A recovery session expires after 60 minutes absolutely or 15 minutes without deliberate visible interaction. Background requests and passive reads do not refresh idle time. Sensitive operations need a fresh credential proof within five minutes. Reauthenticate the current identity; this rotates the capability while retaining the absolute cap. An expired session requires a new sign-in.

## Email alerts remain pending

Inspect **Diagnostics** and the active administrators' in-app security alerts. Durable email intents remain pending when the provider/worker is unavailable and retry with backoff and leases. Restore configured email delivery and scheduler maintenance, then verify delivery. Authentication mutations must commit their mandatory audit and alert intents; database write failures reject the mutation.

## No identity or database is available

Use the separately held backup/second identity, or the imported legacy password bridge if it has not been retired. That bridge opens only recovery. If all credentials are lost or PostgreSQL is unavailable, follow the external infrastructure recovery procedure. Environment edits and import-record deletion are not supported application recovery.
