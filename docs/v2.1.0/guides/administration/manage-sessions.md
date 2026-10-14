---
title: Review and revoke signed-in sessions
description: Inspect account sessions and recent device activity, revoke access, and respond to an untrusted device.
type: how-to
product_area: identity
audience: [responder, administrator]
reader:
  { status: READER_COMPLETE, task: Review and revoke account sessions and recent device activity. }
verification:
  {
    level: source,
    verified_at: 2026-10-12,
    evidence:
      [src/app/(app)/settings/security/page.tsx, src/components/settings/ActiveSessionsSection.tsx],
  }
---

# Review and revoke signed-in sessions

System [authentication policy](../identity/authentication-modes/) is enforced
when an existing session makes its next protected server request. Password Only
rejects OIDC sessions; SSO Required rejects ordinary password sessions. Method-specific
revocation cutoffs also keep sessions revoked after a mode is relaxed again.
Emergency sessions are independent recovery capabilities with a one-hour hard cap
and 15-minute idle timeout. They never appear as ordinary User/trusted-device
sessions. Passive reads do not refresh their idle time. The imported legacy
password bridge opens only recovery and can be retired after two independent drills.

## Before you begin

Sign in from a trusted device and preserve a break-glass access path.

1. Review unfamiliar session and device activity.
2. Revoke the affected session or all sessions.
3. Remediate the password or identity provider.
4. Verify revoked browsers must authenticate again.

## Open the feature

Open **Settings -> Security** and find **Signed-in Sessions**. Each row is an
authentication session, not merely a device profile. Review the browser,
operating system, device type, authentication kind (**Password**, **Trusted
PWA**, or **Enterprise SSO**), creation time, last activity, expiry, opaque
display ID, and whether the row is the current session. OpsKnight does not show
an IP address, network, or inferred location in this view.

Administrators can also inspect **Settings → System → SSO / Authentication →
Diagnostics**. Filter the 100 most recent registered sessions by Password or OIDC,
review expiry, issuing-policy version and active/revoked/expired state, and use
**Revoke session** with fresh authentication. The opaque row handle is distinct
from the secret JWT capability. Revocation commits an audit and security alert.
An emergency principal can revoke authentication sessions through the recovery
console but cannot access ordinary product administration.

## Configure revocation

Revoke a specific unfamiliar session first when the account remains under your
control. Confirm it disappears and that the affected browser must authenticate
again. Use **Revoke all sessions** for a lost device, suspected credential
exposure, or uncertain scope. This increments the identity token version and
invalidates existing browser sessions, including other trusted devices.

## How session revocation works

After emergency revocation, change the password when direct authentication is
used, revoke/repair provider access when SSO is compromised, review audit and
recent device activity, and re-enrol only trusted devices. Push subscriptions
are per-device and separate from an interactive login session; review mobile
Push device cleanup as part of a lost-device response.

## Verify revocation

Confirm the row disappears and the revoked browser must authenticate again.

## Undo or restore access

The old session cannot be restored. Authenticate again after securing the
account and device.

## Troubleshooting

If activity looks stale, reload before acting. If a revoked session continues
to access data, capture the request time and session/device details, verify all
web replicas share the current database/session state, and escalate as a
security incident.

## Next steps

- [Manage users](./manage-users)
- [Audit Logs](./audit-logs)
