---
title: Navigation, Search, and Alerts
description: Find operational records, move through the desktop application, and triage the signed-in notification inbox.
order: 2
---

# Navigation, Search, and Alerts

OpsKnight keeps the most common response workflows in the desktop sidebar and top bar. Use this guide to find records quickly and distinguish the in-app alert inbox from external paging channels.

## Desktop navigation

The sidebar groups the signed-in application into three working areas:

- **Dashboard, Incidents, and Services** for the active response loop;
- **Operations** for teams, users, schedules, and escalation policies; and
- **Insights** for analytics, postmortems, status, action items, reports, and administrative event logs and audit log evidence (available to Admins only).

The visible page is highlighted. Collapse the sidebar when more horizontal space is useful; collapsing it does not change access. Some destinations and actions are still restricted by application role or resource ownership. A hidden or disabled control is not the authorization boundary—OpsKnight checks permission on the server.

Use **Create** in the top bar for the creation workflows available to your role. Before creating a second record, search for an existing incident or service and check the event deduplication behavior for automated alerts.

## Global search

Select the top-bar search field or press `Ctrl+K` on Windows/Linux or `Command+K` on macOS. Enter at least two characters. Search currently matches:

- incidents by title, description, or ID;
- services by name or description;
- teams by name or description; and
- users by name or email.

Use the arrow keys to move through results, `Enter` to open the selected result, and `Escape` to close search. Search also offers quick links for the incident list, service directory, and incident creation.

The browser stores up to five recent query strings in local storage for convenience. They are local to that browser profile, are not an audit record, and disappear when site data is cleared. Avoid entering secrets or sensitive customer data as search terms on shared devices.

### Search boundaries

- Results are capped per record type and favor recently created matches; global search is navigation, not a complete export or discovery API.
- The server can search escalation policies and non-archived postmortems, but the current desktop result menu renders only incidents, services, teams, and users. Use the relevant list page for policies or postmortems.
- Global search requires a signed-in session. It is an internal UI endpoint, not a published API-key contract.
- Search visibility follows the current v1.4 query behavior. Do not use the presence or absence of a result as proof of authorization, deletion, or retention.
- For precise filtering, bulk work, or complete result sets, use the filters and pagination on the destination page.

If search appears stale, close and reopen it, retry with a shorter distinctive term, then use the destination list. If every search fails, confirm the session is still valid and ask an operator to check application and PostgreSQL health.

## In-app alert inbox

Select the bell in the desktop top bar to open the signed-in user's inbox. The badge shows unread count, capped visually at `99+`. The drawer loads up to 50 recent notifications and provides **All** and **Unread** views.

Select an incident notification to open its incident. Use **Mark all as read** only after reviewing the unread view. Opening the drawer does not automatically clear unread state.

The desktop inbox receives live updates through a server-sent-events connection. If that connection fails, the client falls back to polling approximately every 30 seconds. A delayed badge therefore does not prove that escalation or external delivery stopped; reload or reopen the drawer and verify the incident timeline and Notification History.

The mobile **Alerts** route provides its own all/unread list and read-state actions. See [Mobile](../mobile/README.md) for the exact route and offline-queue boundary.

## Inbox versus paging

An in-app notification requires the user to be signed in and looking at OpsKnight. It is not a substitute for an external on-call channel.

| Surface                                       | Purpose                                  | Delivery evidence                                      |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Bell / mobile Alerts                          | Personal in-app awareness and navigation | Record appears and read state changes.                 |
| Notification History                          | Administrative delivery diagnostics      | Attempt, provider status, timing, and error details.   |
| Email, SMS, push, WhatsApp, Slack, or webhook | Reach a responder or external system     | Provider acceptance plus a controlled end-to-end test. |

For a paging test, trigger a synthetic incident through the same service and escalation policy used in production. Verify the incident timeline, intended recipient, in-app record, external provider result, and the responder's actual device. A green inbox state alone is not end-to-end evidence.

## Keyboard navigation

Global search uses the platform shortcut above. OpsKnight also implements `g`-then-key navigation and page-specific shortcuts. Because a few displayed combinations overlap, use the verified [Keyboard shortcuts](../accessibility/shortcuts.md) reference instead of guessing from a label.

When a shortcut conflicts with a browser, operating system, assistive technology, or text field, use the visible control. Report the browser, operating system, route, focused element, and exact key sequence when raising an accessibility issue.

## Troubleshooting

| Symptom                                     | Check                                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| No search results                           | Use at least two characters; try a distinctive title/name; use the destination page filters; confirm session and database health. |
| A policy or postmortem is not shown         | This is a current result-menu boundary; open **Escalation Policies** or **Postmortems** directly.                                 |
| Search opens the wrong record               | Confirm the record type, title, subtitle, and ID before selection; duplicate names can exist across types.                        |
| Bell count does not update                  | Reopen/reload, check the live connection fallback, and verify `/api/notifications` through application logs.                      |
| Notification is present but no page arrived | Check user preferences, contact/device data, provider configuration, escalation targeting, and Notification History.              |
| Mark-all-read appears ineffective           | Refresh once; if state returns, inspect the notification API response and server logs before repeating.                           |

## Related topics

- [Dashboard](./dashboard.md)
- [Incident management](./incidents.md)
- [Notifications](../administration/notifications.md)
- [Users and preferences](./users.md)
- [Mobile](../mobile/README.md)
- [Keyboard shortcuts](../accessibility/shortcuts.md)
- [Troubleshooting](../troubleshooting.md)
