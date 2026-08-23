---
order: 4
title: Mobile PWA
description: Install and operate the mobile experience, web push, local app lock, and supported offline actions
---

# Mobile PWA

OpsKnight provides a mobile-first application under `/m` and a Progressive Web App (PWA) manifest whose start URL is `/m`. It is a browser application: installation, push delivery, background sync, and local-device protection depend on browser and operating-system support.

## Install

Open the OpsKnight URL on a mobile device over HTTPS, then use the browser's install option:

- **iPhone/iPad (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** browser menu → **Install app** or **Add to Home Screen**.

The manifest requests standalone display and portrait orientation. The PWA service worker is disabled in development and can also be disabled by setting `DISABLE_PWA=true`; in either case installation and web push will not work as a production PWA flow. The production build generates `/sw.js` and imports `/custom-sw.js` for OpsKnight's push and offline-queue handlers.

## Push notifications

In the mobile app, open **More** and enable push notifications. The browser asks for notification permission, registers `/sw.js`, retrieves the current public VAPID key, and stores the subscription with OpsKnight.

Push requires all of the following:

- A secure origin (HTTPS), except `localhost` during local development.
- Browser support for Service Workers and Push API.
- A valid Web Push/VAPID configuration in OpsKnight.
- Permission granted in the browser and not later blocked at the operating-system level.

Use the built-in test action after subscribing. A successful subscription only proves the device/browser registration path; also test an actual incident notification and check notification history.

The service worker opens the URL supplied by a notification payload, or `/m/notifications` when none is supplied. Notification actions are browser-dependent; users should open the incident before relying on any response action.

## Offline behavior

Offline support is deliberately limited. Selected last-known list data is encrypted and stored in browser `localStorage`. A separate request queue in IndexedDB stores a small set of user actions.

| Capability                                                               | Offline behavior                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Incident list                                                            | Can show a previously cached mobile incident list. The data can be stale.            |
| Notification list                                                        | Can show a previously cached notification list when available.                       |
| Service, schedule, and team lists                                        | Can show the corresponding last-known list; service/team search caches are separate. |
| Detail pages and all other read views                                    | No documented offline guarantee.                                                     |
| Acknowledge, snooze, or resolve from the mobile incident list            | The mobile client can queue the status update if it detects it is offline.           |
| Mark one notification read or mark all notifications read                | The mobile client can queue the request while offline.                               |
| New incidents, detail-page actions, notes, assignments, and admin writes | Not queued. Reconnect first.                                                         |

Queued requests are stored locally in the browser, then retried on background sync when supported or when the mobile app comes online. Requests are not a durable incident command log: clearing site data, signing out, device loss, browser eviction, expired sessions, authorization changes, malformed requests, or server-side conflicts can prevent an action from being applied. Retryable responses—including 401, 408, 429, and server errors in the client queue—can remain queued; do not assume they will eventually succeed without checking the incident. The service-worker retry classification is narrower than the foreground client, so behavior can also depend on which component performs the retry.

The last-known list cache is encrypted by browser-side application code. It reduces casual disclosure in storage inspection but is not a user-held encryption boundary: the application code needed to decrypt it is delivered to the same browser. Device encryption, screen lock, session controls, MDM, and remote wipe remain the security controls.

After reconnecting, open the incident and confirm its server-side status and timeline before treating an offline action as complete. Do not use offline mode for a time-critical acknowledgement when another online response path is available.

## Local app lock

**More → App Lock** enables a client-side privacy screen when the mobile app is backgrounded. It uses the browser/device's available local authentication experience; it is not a replacement for OpsKnight authentication, session expiry, device encryption, MDM, or remote wipe.

Use it as an additional protection on shared or frequently handled devices. Keep the device operating system, browser, and screen lock updated.

## Operator checklist

Before announcing mobile support to responders:

1. Serve the deployment over HTTPS and confirm `/manifest.webmanifest`, `/sw.js`, and `/custom-sw.js` are reachable.
2. Install the PWA on a representative iOS and Android device.
3. Configure Web Push, subscribe, and send a test notification.
4. Trigger a synthetic incident and verify the notification opens the intended mobile route.
5. Test an offline incident status update, reconnect, and verify the resulting incident timeline.
6. Test denied notification permission and a missing/invalid VAPID configuration so support staff know the expected errors.

## Troubleshooting

**The app does not offer installation**

Confirm HTTPS, the manifest, and the service worker are available. PWA is intentionally disabled in development and when `DISABLE_PWA=true`. Browser-specific install heuristics can also suppress an install prompt; use the browser menu.

**Push subscription fails**

Check browser notification permissions, HTTPS, service-worker registration, and VAPID configuration. A PEM-formatted public key is not valid here: the client expects a base64url VAPID public key. If permissions were denied, change them in browser or device settings and try again.

**An offline action did not appear after reconnecting**

Open the affected incident online and inspect its timeline. The queue may have been removed after a non-retryable response, retained after an authentication/rate-limit/server response, or lost from local browser storage. Repeat the action while online if it is still required.

## Related topics

- [Mobile overview](../mobile/README)
- [Notification providers](../administration/notifications)
- [Configuration reference](../getting-started/configuration)
- [Troubleshooting](../troubleshooting)
