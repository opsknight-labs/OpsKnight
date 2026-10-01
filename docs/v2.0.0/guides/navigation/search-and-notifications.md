---
title: Search and process in-app notifications
order: 2
description: Navigate the desktop application, search authorized records, and process the personal notification inbox.
type: how-to
product_area: platform
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Find an authorized record and process personal in-app notifications. }
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/components/SidebarSearch.tsx
    - src/app/api/search/route.ts
    - src/components/TopbarNotifications.tsx
    - src/hooks/useNotificationStream.ts
---

# Search and process in-app notifications

## Before you begin

Sign in with the role and team memberships you normally use. Search and inbox
results respect the current user's authorization, so missing results may be an
access boundary rather than a data problem.

## Open the feature

Use the desktop sidebar to move between Dashboard, Incidents, Services, Teams,
on-call, analytics, and settings surfaces available to your role. Open sidebar
search or focus a visible search input with `/`. Select the bell in the top bar
to open the personal in-app notification drawer.

## Configure and use search

1. Enter at least two meaningful characters. Queries are bounded and normalized.
2. Review the result type before opening a match. Search can return authorized
   incidents, services, teams, users, escalation policies, and postmortems.
3. Add a more specific title, identifier, service, or person fragment if results
   are broad.
4. Open the result and verify its record identity before taking an action.

Search is permission-aware. Incident and service queries apply authorization
filters, and privileged-only result types are not a bypass around normal access.
The endpoint is rate limited, so rapid automation or repeated queries can return
a temporary rate-limit response.

## Process the notification inbox

1. Open the top-bar bell and inspect the unread badge.
2. Use **All**, **Unread**, **Incidents**, or **Shifts** to narrow the drawer.
   Service notifications remain identifiable by their service type in the list.
3. Select a notification with an incident target to open that incident.
4. Use the inline control to mark one item read, or **Mark all as read** after
   reviewing the outstanding items.
5. Treat the **Live** badge as an active event stream and **Polling** as the
   fallback state. Either mode can deliver updates; verify critical work on the
   Incidents page rather than relying only on the badge.

## How it works

- **In-app inbox:** a personal, signed-in activity drawer with read/unread state.
- **Paging providers:** email, SMS, voice, push, WhatsApp, Slack, or Teams delivery
  used to reach responders outside or alongside the web application.
- **Delivery history/operations:** administrator evidence about provider attempts,
  outcomes, retries, and failures; it is not a user's unread inbox.

Reading an in-app item does not acknowledge or resolve its incident, and it does
not prove an external page was delivered.

## Verify the result

Create or use a controlled event that produces a visible notification. Confirm
the unread count changes, the appropriate filter contains the item, the target
opens correctly, and marking it read persists after closing and reopening the
drawer. Confirm a user without access cannot discover the protected record in
search.

## Change or undo it

Read state can be changed only through the available inbox actions; marking an
item read does not mutate the underlying incident. Restore or change access in
the owning team/role workflow, not through search. Adjust external channel
preferences under **Settings → Profile → Notifications**.

## Troubleshooting

- **Search returns nothing:** use two or more characters, simplify punctuation,
  check spelling, and verify access to the record.
- **Search is temporarily unavailable:** wait for the displayed/retry interval
  if rate limited, then try a narrower query.
- **The unread count looks stale:** reopen the drawer; check whether it reports
  Live or Polling, then reload and verify the source event.
- **A drawer item does not navigate:** service or shift items may not carry an
  incident target. Use the relevant service or schedule area.
- **An external page is missing:** inspect provider configuration, routing, user
  preferences, and delivery history; inbox state is separate.

## Next steps

- [Keyboard shortcuts](../../reference/keyboard-shortcuts)
- [Profile and notification preferences](../profile/manage-profile-and-preferences)
- [Inspect notification delivery](../notifications/inspect-delivery)
- [Manage permissions](../administration/manage-permissions)
