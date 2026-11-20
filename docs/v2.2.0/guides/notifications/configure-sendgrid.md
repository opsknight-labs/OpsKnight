---
title: Configure SendGrid email
order: 5
description: Configure a verified SendGrid sender and restricted API key for OpsKnight email delivery.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure SendGrid email delivery., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/email.ts] }
---

# Configure SendGrid email

## Before you begin

Use a SendGrid account with an authenticated domain or verified sender and permission to create a restricted mail-send key.

## Open the feature

In OpsKnight, open **Settings → Notifications** (`/settings/notifications`) and locate **SendGrid** under Email Providers.

## Configure SendGrid

1. In SendGrid, complete domain authentication or verify the exact sender address.
2. Create a dedicated API key with the minimum mail-send permission.
3. Enter the API key and verified from-address in OpsKnight, save, and enable the provider.
4. Send a controlled provider test.
5. Confirm the OpsKnight attempt and SendGrid activity, then exercise the real incident route.

## What OpsKnight does

OpsKnight encrypts the key and submits selected email notifications through SendGrid. Provider acceptance and recipient delivery remain separate outcomes.

## Verify the result

Confirm the OpsKnight attempt, SendGrid activity, and controlled recipient delivery.

## Change or undo it

For rotation, validate a replacement key before revoking the old one. Move routes before disabling the provider.

## Troubleshooting

Distinguish API authentication, unverified sender, suppression/bounce, and recipient rejection. Keep the key out of tickets and logs.

## Next steps

- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
