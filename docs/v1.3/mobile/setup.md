---
order: 1
title: Mobile setup
description: Install OpsKnight as a PWA, enable web push, and prove end-to-end incident delivery
---

# Mobile setup

Set up one responder device, prove incident delivery, and then use the same checklist for the rest of the on-call team.

## Before you start

Ask an OpsKnight administrator to confirm:

- the deployment is served over HTTPS;
- production PWA generation is enabled (`DISABLE_PWA` is not `true`);
- `/manifest.webmanifest` and `/sw.js` are reachable;
- Web Push has a valid public/private VAPID key pair; and
- your account can receive notifications for a test service and escalation policy.

PWA and push behavior varies by browser and operating system. Use a currently supported browser and keep the device screen lock enabled.

## 1. Sign in to mobile

Open `https://YOUR_OPSKNIGHT_HOST/m` and sign in with the same credentials or OIDC provider used on desktop. OpsKnight may route a recognized mobile browser to `/m` automatically unless the device previously selected desktop mode.

Confirm that **Home**, **Incidents**, **Services**, **Alerts**, and **More** appear in the bottom navigation.

## 2. Install the PWA

### iPhone or iPad

1. Open `/m` in Safari.
2. Open **Share**.
3. Select **Add to Home Screen**.
4. Confirm **Add**, then launch OpsKnight from its icon.

### Android

1. Open `/m` in Chrome.
2. Open the browser menu.
3. Select **Install app** or **Add to Home screen**.
4. Launch the installed app.

### Desktop Chrome or Edge

Use the install control in the address bar or browser menu when it is available. Desktop installation is optional; `/m` remains the mobile-oriented route.

If the browser does not expose installation, continue using `/m` in the browser and ask an operator to check HTTPS, manifest, service worker, and PWA build settings.

## 3. Enable push

1. In the mobile app, open **More**.
2. Find **Push Notifications** under Preferences.
3. Enable it and accept the browser or operating-system permission prompt.
4. Use the built-in test action and keep the app installed while testing.

If permission was denied, change it in the browser/site or operating-system settings. OpsKnight cannot reopen the permission prompt after the browser has blocked it.

## 4. Test the responder path

1. Trigger a synthetic incident for a service whose policy targets your account or current schedule.
2. Confirm a notification arrives while the app is in the background.
3. Open it and verify it lands on the intended mobile incident or Alerts route.
4. Acknowledge the incident.
5. Reload the detail page and confirm the timeline and status changed on the server.
6. Resolve the synthetic incident with a clear resolution note.

Do not onboard the rest of the team based only on the built-in push test. The synthetic incident proves service routing, schedule resolution, escalation, provider delivery, service-worker display, deep linking, authentication, and the response action together.

## 5. Record the result

For each supported device/browser combination, record:

- operating system and version;
- browser and version;
- install result;
- permission result;
- synthetic incident ID and time;
- notification arrival time;
- deep-link destination; and
- acknowledgement reflected on the server.

Repeat this test after proxy changes, certificate changes, VAPID rotation, major browser upgrades, or OpsKnight upgrades.

## Common failures

**No install option**

Use the browser menu, verify HTTPS, and ask the operator to fetch `/manifest.webmanifest` and `/sw.js`. Development builds and deployments with `DISABLE_PWA=true` intentionally disable the production service worker.

**No permission prompt**

Check existing site and OS notification settings. Permission may already be allowed or denied, or the browser may not support Push API for this installation mode.

**The built-in test works but incidents do not page**

Check the service escalation policy, current schedule, your notification preferences, notification history, and provider logs. A device subscription does not select the incident's recipient.

**Notification opens a sign-in page**

Your OpsKnight session expired. Sign in again, then open the incident and verify its current status before acting.

## Next steps

- Read the [mobile route and offline support matrix](./README).
- Give operators the [PWA production checklist](../deployment/mobile-pwa).
- Review [notification provider troubleshooting](../administration/notifications).
