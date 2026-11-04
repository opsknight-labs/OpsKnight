---
title: Troubleshoot emergency access
description: Diagnose emergency password, hardware-key enrollment, drill, session and alert failures.
type: troubleshooting
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-14
  evidence:
    [src/lib/auth-control/emergency.ts, tests/integration/emergency-authentication-database.test.ts]
---

# Troubleshoot emergency access

For custodians using `/login/emergency` and administrators using **Settings → System → Emergency Access**. See [setup and custody](../../guides/identity/configure-emergency-access/) and [lockout recovery](../../guides/identity/sso-lockout-recovery/).

## Enrollment or sign-in fails

Use the recorded account identifier and an active independently held hardware key. Complete its PIN/user-verification ceremony. Synced passkeys are rejected. Verify HTTPS, the exact canonical origin and original RP hostname; reverse-proxy host changes and credentials enrolled on another hostname fail origin/RP verification. Request a new challenge after cancellation, expiry, browser changes or reuse. Challenges expire in five minutes and are bound to their initiating browser.

A counter rollback, revoked key or changed credential version rejects the signature. Do not reset stored counters to bypass verification. Use a backup key or second identity, investigate a possible clone and revoke the affected credential. Shared network limits expire without permanently locking the emergency account; retry after the limit window or use an authorized alternate network.

## Readiness disappears

Enrollment/revocation invalidates that identity's previous drill and all its sessions. Sign in again using the identity's current configured credential. Disabled identities and drills older than 90 days do not count. Required activation needs two independently held ready identities; repeat drills after changes. A browser login test for SSO is separate from both independent recovery drills and discovery health.

## Session ends while the page stays open

A recovery session expires after 60 minutes absolutely or 15 minutes without deliberate visible interaction. Background requests and passive reads do not refresh idle time. Sensitive operations need a fresh credential proof within five minutes. Reauthenticate the current identity; this rotates the capability while retaining the absolute cap. An expired session requires a new sign-in.

## Email alerts remain pending

Inspect **Diagnostics** and the active administrators' in-app security alerts. Durable email intents remain pending when the provider/worker is unavailable and retry with backoff and leases. Restore configured email delivery and scheduler maintenance, then verify delivery. Authentication mutations must commit their mandatory audit and alert intents; database write failures reject the mutation.

## No identity or database is available

Use the separately held backup/second identity, or the imported legacy password bridge if it has not been retired. That bridge opens only recovery. If all credentials are lost or PostgreSQL is unavailable, follow the external infrastructure recovery procedure. Environment edits and import-record deletion are not supported application recovery.

## Alert bursts and distributed failure traffic

Every failed attempt retains an individual security event and mandatory audit.
Anonymous failure notifications are aggregated in a shared PostgreSQL five-minute
window across IPs and web replicas: the first failure and twentieth failure generate
alerts to at most 100 active administrators each. Further attempts remain searchable
in Diagnostics without another email/in-app fan-out in that window. Sensitive
successful operations and compromise/degraded-recovery events still alert admins.

IP, account-identifier and instance-wide admission limits are independent. A
rate-limited attempt cannot allocate another WebAuthn challenge. Retrying from many
IPs does not bypass the shared instance budget. Investigate perimeter abuse, but do
not delete individual evidence or disable origin checks to reduce queue pressure.
The threshold/recipient cap is an application guard, not a substitute for ingress
abuse protection and appropriate database capacity.

Security emails link to the configured instance’s authentication diagnostics. If
canonical URLs conflict, delivery is deferred rather than generating a link to an
untrusted host. Repair the deployment/database URL and inspect pending delivery.
Notifications use the existing provider queue, admission controls, and retries.

## A stale recovery cookie accompanies a valid administrator session

Expired or revoked recovery cookies are ignored when a separately valid ordinary
administrator session exists. Authentication dashboard responses clear the stale
cookie. This does not convert a recovery principal into an administrator. If the
normal session was also revoked by policy or the user was demoted, sign in again
through an allowed method. Never preserve an old rotated cookie for automation.

## Origin conflict and infrastructure outage

Use the [pinned-origin recovery procedure](../../guides/identity/sso-lockout-recovery/).
The pin must be the exact trusted WebAuthn origin; a different hostname cannot reuse
old hardware credentials. Database outage, missing policy, and missing encryption
keys remain infrastructure incidents. Restore from governed backups and account
for previously revoked state reappearing. Test the repaired public ingress on each
replica before closing the incident.


## Independent emergency password fails

Select **Password** and use the emergency account identifier and generated recovery
secret, not an ordinary user's email/password. Passwords are displayed once during
creation or rotation and cannot be recovered from their salted hash. Check the vault
copy and current method with an authorized custodian; a rotated password or disabled
identity fails immediately. Failure messages do not confirm whether an account exists.
Network/account limits and bounded password-hashing concurrency may require a short
retry; reauthentication has its own session budget. Never disable these checks.
Use another independently held identity if the vault depends on the unavailable IdP.

Reauthentication requires the current recovery cookie, keeps the original one-hour
expiry and does not turn a recovery principal into an ordinary User. If rotation
revoked the session, start a new sign-in with the replacement credential. A new password
identity counts toward Required only after its independent sign-in drill succeeds.
