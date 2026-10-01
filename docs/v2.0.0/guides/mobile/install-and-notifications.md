---
title: Install the mobile PWA and enable push
description: Install OpsKnight on a trusted device, enable push notifications, and verify incident deep links.
type: how-to
product_area: mobile
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Install and verify OpsKnight mobile push. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/mobile/PwaInstallCard.tsx", "src/components/mobile/PushNotificationToggle.tsx", "src/components/mobile/MobilePwaCoordinator.tsx", "public/custom-sw.js"]
---

# Install the mobile PWA and enable push

## Before you begin

Use a supported current browser on a device protected by screen lock. Open OpsKnight through its production HTTPS URL; push and service-worker features are not a substitute for a trusted TLS deployment. Confirm notification permission is not blocked at OS/browser level.

## Open the feature

Open `/m`, sign in, then open **More**. Use the install and push-notification cards shown for the current browser.

## Configure installation and push

1. Select the browser's **Install app** action, or use its add-to-home-screen menu when no prompt appears.
2. Launch the installed app and sign in again if the browser uses a separate installed-app session.
3. Enable **Push notifications** and approve the browser/OS prompt.
4. Keep the device online while the subscription is registered.
5. Send a controlled test push from the supported notification settings flow.
6. Tap the notification and confirm its deep link opens the expected mobile incident.

## What OpsKnight does

The PWA registers a service worker, stores a push subscription for the signed-in user, and routes incident notifications to mobile incident detail. Session and trusted-device behavior remains governed by normal authentication/security policy; installing the PWA does not create a permanent bypass.

## Verify the setup

Confirm the app launches without browser chrome, the push toggle reports enabled, a test notification arrives with the app backgrounded, and tapping it opens the correct incident rather than only the mobile home page.

## Remove or undo

Disable push in OpsKnight before removing the installed app when possible, then remove the site/app through browser or OS settings. Revoke the session from security settings if the device is lost or no longer trusted.

## Troubleshooting

- **No install option:** use HTTPS, a supported browser, and revisit after the service worker is ready.
- **Permission denied:** change the site's notification permission in browser/OS settings, then retry.
- **Push enabled but silent:** check OS focus/battery restrictions and send a controlled test.
- **Wrong deep link:** preserve notification payload details and inspect service-worker logs.

## Next steps

- [Respond to incidents on mobile](./respond-to-incidents)
- [Offline behavior and updates](./offline-and-updates)
