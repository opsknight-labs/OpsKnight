---
title: Configure independent emergency access
description: Configure independent emergency access with staged configuration, explicit verification and audited recovery.
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

# Configure independent emergency access

For administrators and security-key custodians. Emergency identities are separate principals, never responders, normal Users, SCIM users, JIT identities or trusted devices.

## Prerequisites and custody

Use the canonical public HTTPS origin and a browser with WebAuthn hardware-key support. Hold two separately controlled identities and hardware keys outside the IdP failure path. Keep backup keys and account identifiers in a tested external recovery procedure. Synced passkeys and backup-eligible credentials are rejected. User verification (for example a key PIN) is required.

The server stores public keys only. With privacy-preserving attestation, it cannot cryptographically prove that two registrations represent different physical keys or different custodians. The custody confirmation is an operator obligation: use distinct independently held hardware, and test each in a separate browser session. Changing the public RP hostname requires deliberate re-enrollment; existing credentials are bound to that RP.

![Emergency identity and hardware-key enrollment](../../assets/enterprise-emergency-access.png)

## Enroll and drill

1. Sign in freshly as an administrator. Open **Settings → System → Emergency Access**.
2. Create an identity with a recognizable custodian label and confirm independent key custody. Record its generated account identifier externally.
3. Enter a key label, choose **Enroll hardware key**, and complete the browser ceremony with user verification. Add a backup key before the final drill.
4. Open `/login/emergency` in a separate browser. Enter the account identifier and choose **Sign in with hardware key**.
5. Verify that only the restricted recovery console opens. It must not open incidents, ordinary settings or a normal User session.
6. Repeat with a second independently held identity. Return to Emergency Access and confirm both are verified for their current credential versions.

Enrollment alone does not establish readiness. A successful hardware-key sign-in marks an identity active and verifies the current credential version. Any enrolled/revoked key invalidates the drill and revokes sessions for that identity. Drill again after changes and at least every 90 days.

## Session limits, alerts and key maintenance

Recovery sessions have a hard 60-minute maximum and a 15-minute inactivity timeout. Passive page reads never extend idle time. Visible keyboard/pointer activity updates idle time; sensitive operations need credential verification within five minutes. Reauthentication rotates the cookie but retains the original hard expiry. Logout, disablement and credential-version changes revoke access immediately.

Enrollment, login successes/failures, revocation, policy changes and recovery repairs commit audit events and durable high-priority security notifications. Email outages retain pending intents and in-app alerts; inspect Diagnostics and restore the delivery worker/provider.

Enroll and drill a replacement independent identity before disabling a ready account or rotating its last key under Required. For an actual compromised key, use the explicit compromise confirmation; this may reduce readiness and demands an immediate replacement drill. The final remaining ready identity cannot be revoked through this screen. Protect recovered access while addressing the incident.

After two successful independent drills, use **Retire legacy emergency password**. The original User and references remain intact; the imported password bridge and its recovery sessions are removed. See [Emergency troubleshooting](../../troubleshooting/login/emergency-access/) for lost keys and database outages.
