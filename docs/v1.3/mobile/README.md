---
order: 9
title: Mobile
description: Exact mobile route, incident-response, PWA, push, and offline support in OpsKnight v1.3
---

# Mobile

OpsKnight includes a touch-oriented application under `/m`. It uses the same account, roles, data, and server-side authorization as the desktop application. It can run in a browser or as an installed Progressive Web App (PWA).

Use mobile for incident response and read-oriented operational checks. Use desktop mode for configuration workflows that do not have a mobile editor.

Start with [Mobile setup](./setup). Operators should also complete the production checklist in [Mobile PWA](../deployment/mobile-pwa).

## Navigation

The bottom navigation contains **Home**, **Incidents**, **Services**, **Alerts**, and **More**. **More** links to teams, users, schedules, policies, analytics, postmortems, status, profile settings, help, PWA installation, theme, app lock, push, and desktop mode.

### Route and task matrix

| Route                                      | Mobile capability                                                                                                                                                                       | Important boundary                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/m`                                       | View operational summary, current on-call information, recent incidents, and quick links                                                                                                | Summary data is online server data                                                                           |
| `/m/incidents`                             | Filter incidents; acknowledge, snooze, or resolve from list cards; open create and detail pages                                                                                         | List-card status actions are the incident writes supported by the offline queue                              |
| `/m/incidents/create`                      | Create an incident with title, service, urgency, description, and optional assignee                                                                                                     | Requires a connection and applicable server permission                                                       |
| `/m/incidents/[id]`                        | View status, timeline, notes, watchers, tags, and postmortem link; acknowledge, resolve with a note, add a note, change urgency, take ownership, snooze/unsnooze, reassign, or unassign | Detail-page actions require a connection; the offline queue is implemented only by the list action component |
| `/m/services` and `/m/services/[id]`       | Search/view services, health and open incidents; create an incident for a service                                                                                                       | Service configuration remains a desktop workflow                                                             |
| `/m/notifications`                         | View all/unread alerts, mark one read, or mark all read                                                                                                                                 | Read-state actions can be queued offline                                                                     |
| `/m/schedules` and `/m/schedules/[id]`     | View schedules, current on-call, layers, rotations, time zone, and participants                                                                                                         | Create/edit schedules and overrides on desktop                                                               |
| `/m/policies` and `/m/policies/[id]`       | View escalation policies, ordered steps, targets, and attached services                                                                                                                 | Create/edit policies on desktop                                                                              |
| `/m/teams` and `/m/teams/[id]`             | Search/view teams, members, and open-incident counts                                                                                                                                    | Team administration remains a desktop workflow                                                               |
| `/m/users` and `/m/users/[id]`             | View the user directory, roles, memberships, and related incidents                                                                                                                      | User administration remains a desktop workflow                                                               |
| `/m/analytics`                             | View mobile analytics and linked incidents                                                                                                                                              | Use desktop for the complete analytics workspace                                                             |
| `/m/postmortems` and `/m/postmortems/[id]` | View postmortem status, summary, root cause, incident, and author                                                                                                                       | Author and edit postmortems on desktop                                                                       |
| `/m/status`                                | View internal service health and active or recent incident information                                                                                                                  | This is authenticated operational status, not the public status-page URL                                     |
| `/m/help`                                  | Open product documentation and support links                                                                                                                                            | External links require connectivity                                                                          |
| `/m/more`                                  | Manage mobile preferences and switch to desktop mode                                                                                                                                    | The **Settings** link opens the desktop settings route                                                       |

Route visibility does not grant permission. Server-side authorization still applies to every action, and a deployment can restrict what a user can read or change through roles and ownership rules.

## Respond to an incident

1. Open **Alerts** or **Incidents**, then open the incident.
2. Confirm the service, urgency, status, assignee, and newest timeline entries.
3. Select **Acknowledge** to signal ownership.
4. Use **More** to add a note, take ownership, change urgency, snooze, or reassign.
5. Resolve with a meaningful resolution note; the mobile detail flow requires at least 10 characters.
6. Reload the incident and confirm the server-side timeline reflects the action.

List cards also expose swipe/touch actions where supported. Avoid gestures while a card is already updating, and verify the resulting status instead of assuming animation equals server acceptance.

## Install and push

The manifest starts installed sessions at `/m`, requests standalone display and portrait orientation, and uses application icons supplied by the deployment. Production PWA behavior requires HTTPS and a working generated `/sw.js`.

Open **More → Install OpsKnight** when the browser exposes the prompt, or use the browser's Add to Home Screen action. Then open **More → Push Notifications**, grant permission, and send the built-in test.

Push requires a valid VAPID configuration, browser Push API support, Service Worker support, and operating-system permission. A subscription is not proof of end-to-end paging: trigger a synthetic incident and verify the notification opens the intended incident or alerts route.

See [Mobile PWA](../deployment/mobile-pwa) for deployment configuration, browser limitations, service-worker behavior, and troubleshooting.

## Offline support matrix

OpsKnight provides selected offline assistance, not a fully offline incident system.

### Last-known reads

The mobile clients store encrypted last-known list data in browser `localStorage` for:

- incidents;
- notifications;
- services, including each search-specific result set;
- schedules; and
- teams, including each search-specific result set.

These caches can be empty, stale, evicted, or cleared. Encryption uses application code available to the browser and is not a substitute for device encryption, screen lock, or remote wipe. Detail pages, home, policies, users, analytics, postmortems, status, and help do not have a documented offline-read guarantee.

### Queued writes

The request queue uses browser IndexedDB. Only these mobile client actions enqueue a request after a network failure while the browser reports offline:

- from the incident list: set status to `ACKNOWLEDGED`, `SNOOZED`, or `RESOLVED`;
- from Alerts: mark one notification read; and
- from Alerts: mark all notifications read.

Creating incidents, incident-detail actions, notes, urgency changes, assignment, schedule or policy administration, and all other writes require a connection.

Queued requests are retried by background sync when supported, an online event, or a manual sync signal. They can remain queued after authentication, timeout, rate-limit, or server failures, and can be removed after a non-retryable response. Browser storage loss removes them entirely. After reconnecting, reload the affected record and verify server state.

## Mobile preferences and security

- **Theme** follows the selected light, dark, or system preference.
- **App Lock** is a local privacy screen when the app returns from the background. It does not replace the OpsKnight session, device passcode, full-disk encryption, MDM, or remote wipe.
- **Push Notifications** registers the current browser subscription with OpsKnight.
- **Switch to Desktop Mode** sets the desktop preference and leaves the `/m` interface. Clear or change that preference through the application when returning to automatic mobile routing.

Do not share an installed authenticated PWA between responders. Sign out before transferring a device, and clear site data when retiring it.

## Troubleshooting

**The browser opens desktop instead of `/m`**

Open `/m` directly. If **Switch to Desktop Mode** was selected earlier, the desktop-preference cookie can suppress automatic mobile routing.

**A mobile page says to use desktop**

The route is intentionally read-only. Follow its desktop link or select **More → Switch to Desktop Mode**.

**Cached data differs from the server**

Reconnect and reload. Last-known data has no freshness guarantee and must not be used as final evidence of acknowledgment, ownership, or resolution.

**An offline action did not synchronize**

Open the affected incident or notification online. Repeat the action only after checking current server state, because another responder may have changed it while this device was offline.

**Push does not arrive**

Check HTTPS, browser and OS permission, `/sw.js`, VAPID configuration, the device subscription, notification history, and provider logs. See [Troubleshooting](../troubleshooting) for deployment checks.

## Related topics

- [Mobile setup](./setup)
- [Mobile PWA operations](../deployment/mobile-pwa)
- [Incidents](../core-concepts/incidents)
- [On-call schedules](../core-concepts/schedules)
- [Notification providers](../administration/notifications)
