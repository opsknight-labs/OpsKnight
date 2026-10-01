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
  evidence: ["src/components/mobile/PwaInstallCard.tsx", "src/components/mobile/PushNotificationToggle.tsx", "src/components/mobile/MobilePwaCoordinator.tsx", "src/app/api/system/vapid-public-key/route.ts", "src/app/api/user/push-subscription/status/route.ts", "src/lib/notification-providers.ts", "public/custom-sw.js", "tests/e2e/mobile-pwa-production.spec.ts"]
---

# Install the mobile PWA and enable push

## Before you begin

Use a supported current browser on a device protected by screen lock. Open
OpsKnight through its production HTTPS URL; Web Push requires a secure context.
Confirm notification permission is not blocked at OS/browser level and ask an
administrator to confirm the Web Push provider is configured.

On iPhone and iPad, open OpsKnight in Safari, select **Share -> Add to Home
Screen**, and launch that installed web app. iOS does not offer OpsKnight Web
Push from an ordinary browser tab. On Android and desktop, installation is
recommended for reliable background use but browser Push may also be available.

## Open the feature

Open `/m`, sign in, then open **More**. Use the install and push-notification cards shown for the current browser.

## Configure installation and push

1. Select the browser's **Install app** action, or use its add-to-home-screen menu when no prompt appears.
2. Launch the installed app and sign in again if the browser uses a separate installed-app session.
3. Wait for the card to finish **Preparing**. OpsKnight prepares its service
   worker and provider key before enabling the action.
4. Select **Enable** and approve the browser/OS prompt. Keep this one action
   directly initiated by your click; this is required by Safari/iOS/macOS and
   other browsers with strict user-gesture rules.
5. Keep the device online while OpsKnight creates the browser subscription,
   saves it to the signed-in account, and verifies registration.
6. Confirm the status reads **On**, then select **Send test Push**.
7. Tap the notification and confirm its deep link opens the expected mobile incident.

## What OpsKnight does

The PWA registers a service worker, stores a per-device subscription for the
signed-in user, and routes incident notifications to mobile incident detail.
The client reconciles the browser subscription, account setting, stored device,
and effective server provider state. Installing the PWA does not bypass normal
session or trusted-device policy.

The database Web Push provider record is authoritative when it exists. A
complete `NEXT_PUBLIC_VAPID_PUBLIC_KEY` plus `VAPID_PRIVATE_KEY` environment
pair is used only when there is no stored provider record. A disabled,
incomplete, or undecryptable stored record does not fall back to environment
credentials. A public key without its private key is not deliverable and is
rejected.

## Understand the displayed state

| Status | Meaning | Action |
| --- | --- | --- |
| **Preparing** | Service worker and provider preflight is running | Wait; do not repeatedly tap |
| **Install required** | iOS/iPadOS is not running the installed Home Screen app | Install from Safari and reopen it |
| **Blocked** | Browser or OS permission is denied | Re-enable notifications in site/OS settings |
| **Sign-in required** | The server cannot associate this device with a user | Sign in, then return to the card |
| **Off** | This device has no active subscription | Select **Enable** |
| **On** | Browser and server registration are reconciled | Send a test Push |
| **Needs repair** | Browser/server state differs or the subscription expired | Select **Repair**, then test |
| **Server unavailable** | The device exists, but effective provider configuration is unavailable | Retry later or remove this device |
| **Needs attention** | Preparation or registration failed | Read the message, correct it, and retry |

## Verify the setup

Confirm the installed app launches, status is **On**, a test notification arrives
with the app backgrounded, and tapping it opens the correct incident rather
than only the mobile home page. Repeat on every device; subscriptions are not
automatically copied between devices.

## Remove or undo

Select **Disable** before removing the installed app, then remove the site/app
through browser or OS settings. When status is **Server unavailable**, use
**Remove this device**; cleanup remains available even though delivery is not.
OpsKnight removes the server registration before asking the browser to
unsubscribe so a failed browser cleanup remains repairable. Revoke the session
from security settings if the device is lost or untrusted.

## Troubleshooting

- **No install option:** use HTTPS and a supported browser. On iOS/iPadOS use
  Safari's **Add to Home Screen** flow.
- **Administrator has not configured Push:** ask an administrator to configure
  a complete Web Push provider. Retrying cannot repair absent VAPID keys.
- **Server unavailable:** the saved device is preserved while provider state
  cannot be verified. Retry when the server is healthy, or remove the device.
- **Permission denied/Blocked:** change the site's notification permission in
  browser and OS settings, then return and retry.
- **Needs repair:** select **Repair** to reconcile an expired or mismatched
  browser/server subscription, then send a test.
- **Preparation fails:** reload over HTTPS. If it continues, verify service
  worker support and ask an administrator to check VAPID configuration.
- **Push is On but silent:** check OS focus/battery restrictions and use **Send
  test Push**. An expired endpoint changes the card to **Needs repair**.
- **Wrong deep link:** preserve notification payload details and inspect service-worker logs.

## Next steps

- [Respond to incidents on mobile](./respond-to-incidents)
- [Offline behavior and updates](./offline-and-updates)
