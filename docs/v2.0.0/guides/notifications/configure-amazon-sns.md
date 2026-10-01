---
title: Configure Amazon SNS SMS
order: 7
description: Configure an AWS region and least-privilege SNS credentials for SMS notifications.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure Amazon SNS SMS delivery., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/sms.ts, src/lib/provider-test-service.ts] }
---

# Configure Amazon SNS SMS

## Before you begin

Choose the AWS account and region, confirm SMS availability for destination countries, and prepare a controlled user with a valid phone number.

## Open the feature

In OpsKnight, open **Settings → Notifications → Providers → AWS SNS**.

## Configure Amazon SNS

1. Choose the AWS region used for SMS and confirm that the account can send to the destination countries.
2. Configure the required origination identity, spending quota, and sandbox/production status in AWS.
3. Create a dedicated IAM principal with only the SNS SMS permissions OpsKnight needs.
4. In OpsKnight, open **Settings → Notifications → Providers → AWS SNS** and enter the region, access-key ID, and secret access key.
5. Add a controlled recipient phone number to the test user, save, enable the provider, and run the provider test.

## What OpsKnight does

OpsKnight encrypts the AWS credentials and asks SNS to send routed SMS messages in the configured region.

## Verify the result

Confirm the OpsKnight attempt, AWS delivery information, and receipt on the controlled phone.

## Change or undo it

Rotate credentials by testing a replacement key before disabling the old key. Move SMS routes before disabling SNS.

## Troubleshooting

Check the region, destination format, account sandbox, country rules, origination identity, IAM denial, and spending quota.

## Next steps

- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
