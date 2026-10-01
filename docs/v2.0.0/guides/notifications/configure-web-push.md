---
title: Configure Web Push
description: Configure VAPID credentials and verify browser push delivery for the OpsKnight PWA.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure Web Push notifications., evidence: [] }
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-providers.ts, src/lib/types/provider-config.ts] }
---

# Configure Web Push

## Before you begin

Serve OpsKnight over its final HTTPS origin. Generate a VAPID key pair and choose a contact subject, normally a `mailto:` address controlled by the operator. Treat the private key as a secret; changing the key can invalidate existing subscriptions.

## Open the feature

In OpsKnight, open **Settings → Notifications → Providers → Web Push**.

## Configure Web Push

1. Open **Settings → Notifications → Providers → Web Push**.
2. Enter the VAPID public key, private key, and subject; save and enable the provider.
3. In a supported browser, install or open the PWA, allow notifications, and register the device.
4. Send a controlled test while the device is online and again while the PWA is in the background.

## What OpsKnight does

OpsKnight encrypts the private VAPID key and uses registered browser subscriptions for routed push notifications.

## Verify the result

Confirm the controlled device receives the test in both foreground and background conditions and that OpsKnight records the attempt.

## Change or undo it

Use the supported key-history/rotation workflow when replacing keys so existing devices can transition. Move routes before disabling Web Push and re-register devices that still use an expired subscription.

## Troubleshooting

Check HTTPS, browser permission, service-worker registration, subscription status, corporate browser policy, and whether the VAPID keys changed.

## Next steps

- [Install the PWA and enable notifications](../mobile/install-and-notifications)
- [Configure routing](./configure-routing)
- [Inspect delivery](./inspect-delivery)
