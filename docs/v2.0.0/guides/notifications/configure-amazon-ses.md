---
title: Configure Amazon SES email
order: 6
description: Configure an SES region, sending identity, and least-privilege credentials for OpsKnight.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure Amazon SES email delivery., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/email.ts] }
---

# Configure Amazon SES email

## Before you begin

Choose the AWS account and region, obtain permission to manage SES identities and IAM credentials, and prepare a controlled recipient.

## Open the feature

In OpsKnight, open **Settings → Notifications → Providers → Amazon SES**.

## Configure Amazon SES

1. In the target AWS region, verify the sending domain or email identity and complete DKIM setup.
2. If the account is in the SES sandbox, verify test recipients or request production access.
3. Create a dedicated IAM principal allowed to send through the chosen identity and region. Record its access-key ID and secret access key.
4. In OpsKnight, open **Settings → Notifications → Providers → Amazon SES**. Enter the region, credentials, and verified from-address; save and enable it.
5. Send a controlled test, confirm the SES message ID and delivery event, and then test the real escalation route.

## What OpsKnight does

OpsKnight encrypts the AWS credentials and submits selected email notifications to SES in the configured region.

## Verify the result

Confirm the OpsKnight attempt, SES message ID and delivery event, and controlled inbox receipt.

## Change or undo it

Rotate the IAM key by validating the replacement in OpsKnight before deactivating the old key. Move routes before disabling SES.

## Troubleshooting

Check region alignment, sandbox status, identity policy, IAM permission, quotas, bounces, and complaints when delivery fails.

## Next steps

- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
