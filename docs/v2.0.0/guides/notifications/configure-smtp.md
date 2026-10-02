---
title: Configure SMTP email
order: 3
description: Connect an SMTP relay, verify its sender identity, test delivery, and rotate credentials safely.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure SMTP email delivery., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/email.ts] }
---

# Configure SMTP email

## Before you begin

Create a dedicated SMTP credential with permission to send only from the OpsKnight sender. Verify the sender address or domain, allow outbound traffic from OpsKnight to the relay, and record the host, port, username, password, TLS requirement, and from-address. Do not use a personal mailbox credential.

## Open the feature

In OpsKnight, open **Settings → Notifications** (`/settings/notifications`) and locate **SMTP** under Email Providers.

## Configure OpsKnight

1. Open **Settings → Notifications** and locate the **SMTP** configuration card.
2. Enter **Host**, **Port**, **Username**, **Password**, and **From email**.
3. Enable secure transport when the relay expects implicit TLS. For STARTTLS, use the relay's documented port and policy.
4. Save, enable SMTP, and send a provider test to a controlled mailbox.

## What OpsKnight does

OpsKnight encrypts the stored password and uses the configured relay when email routing selects SMTP. A saved configuration does not prove relay acceptance or inbox delivery.

## Verify the result

Confirm the message arrived with the expected sender and inspect its authentication results. Then trigger a synthetic incident through the real routing path. If authentication fails, verify the credential, port, TLS mode, egress policy, and relay allowlist. If accepted mail is missing, check suppression, spam, DMARC, and the provider delivery log.

## Change or undo it

Rotate by creating a replacement credential, updating OpsKnight, testing it, and only then revoking the old credential. Before disabling SMTP, move affected routes to a tested provider.

## Troubleshooting

For authentication failures, verify the credential, port, TLS mode, egress policy, and relay allowlist. If accepted mail is missing, check suppression, spam, DMARC, and the provider delivery log.

## Next steps

- [Test a notification](./test-notification)
- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
