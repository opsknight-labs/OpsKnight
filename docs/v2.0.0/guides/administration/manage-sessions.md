---
title: Review and revoke signed-in sessions
description: Inspect account sessions and recent device activity, revoke access, and respond to an untrusted device.
type: how-to
product_area: identity
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Review and revoke account sessions and recent device activity. }
verification: { level: source, verified_at: 2026-10-01, evidence: [src/app/(app)/settings/security/page.tsx, src/components/settings/ActiveSessionsSection.tsx] }
---

# Review and revoke signed-in sessions

## Before you begin

Sign in from a trusted device and preserve a break-glass access path.

1. Review unfamiliar session and device activity.
2. Revoke the affected session or all sessions.
3. Remediate the password or identity provider.
4. Verify revoked browsers must authenticate again.

## Open the feature

Open **Settings -> Security** and find **Signed-in Sessions**. Each row is an
authentication session, not merely a device profile. Review the browser,
operating system, device type, authentication kind (**Standard**, **Trusted
PWA**, or **Enterprise SSO**), creation time, last activity, expiry, opaque
display ID, and whether the row is the current session. OpsKnight does not show
an IP address, network, or inferred location in this view.

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
