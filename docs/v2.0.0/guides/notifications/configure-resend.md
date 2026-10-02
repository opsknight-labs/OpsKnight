---
title: Configure Resend email
order: 4
description: Configure a verified Resend sender and API key for OpsKnight email delivery.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure Resend email delivery., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/email.ts] }
---

# Configure Resend email

## Before you begin

Use a Resend account with a verified sending domain and permission to create a restricted sending key. Choose a controlled recipient for validation.

## Open the feature

In OpsKnight, open **Settings → Notifications** (`/settings/notifications`) and locate **Resend** under Email Providers.

## Configure Resend

1. In Resend, verify the sending domain and publish every required DNS record.
2. Create a dedicated API key with sending access and choose a from-address on that domain.
3. Enter the API key and verified from-address in OpsKnight, save, and enable the provider.
4. Send a provider test to the controlled recipient.
5. Run a synthetic incident through the intended escalation route.

## What OpsKnight does

OpsKnight encrypts the API key and submits selected email notifications to Resend. An accepted API request is not proof of inbox delivery.

## Verify the result

Confirm the OpsKnight attempt, Resend event, and recipient inbox all show the controlled delivery.

## Change or undo it

Rotate by creating a new key, testing it in OpsKnight, and revoking the old key afterward. Move routes before disabling the provider.

## Troubleshooting

For missing mail, inspect domain verification, suppressions, bounces, recipient policy, and Resend events.

## Next steps

- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
