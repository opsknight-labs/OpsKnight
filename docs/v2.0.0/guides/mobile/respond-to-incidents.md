---
title: Respond to incidents on mobile
description: Triage, acknowledge, and follow incidents safely from OpsKnight's mobile experience.
type: how-to
product_area: mobile
audience: [responder]
reader: { status: READER_COMPLETE, task: Respond to an incident from a mobile device. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(mobile)/m/incidents/page.tsx", "src/app/(mobile)/m/incidents/[id]/page.tsx", "src/app/api/mobile/incidents/[id]/status/route.ts"]
---

# Respond to incidents on mobile

## Before you begin

Confirm you are signed in as the intended responder and have incident permissions. Use a reliable connection for state-changing actions; the offline banner explicitly places the application in view-only mode.

## Open the feature

Tap a push notification, or open **Incidents** from the mobile navigation. Filter/search the list and select the incident.

## Configure and perform the response

1. Confirm service, urgency, priority, status, assignee, timestamps, and current responder ownership.
2. Acknowledge only after you accept response responsibility.
3. Refresh and confirm the server state changed.
4. Follow relevant service, team, schedule, policy, status, analytics, and postmortem views from mobile navigation.
5. Resolve only after recovery is verified through the source and runbook.

## What OpsKnight does

Mobile routes apply the same server authorization and incident lifecycle as desktop. Notifications deep-link to `/m/incidents/<id>`. Cached list/detail data may be displayed during a network interruption, but it is labelled and is not proof of current state.

## Verify the response

Require a confirmed server status after acknowledgment/resolution, then cross-check the incident timeline or another connected session. A disappearing spinner alone is not confirmation.

## Undo or correct

Incident lifecycle actions are audited and may not be reversible. If an incorrect transition occurs, add context through the supported incident workflow and escalate rather than modifying storage directly.

## Troubleshooting

- **Action unavailable:** check connectivity, current status, permission, and whether another responder already changed it.
- **Old status displayed:** manually refresh after reconnecting.
- **Push opened login:** the session expired; authenticate and return to the original incident link.

## Next steps

- [Offline behavior and updates](./offline-and-updates)
- [Desktop incident response](../incidents/respond-to-an-incident)
