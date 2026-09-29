---
title: Respond to your first incident
description: Verify notification delivery, acknowledge ownership, investigate, and resolve safely.
type: tutorial
product_area: getting-started
audience: [responder]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/incidents/lifecycle.ts
    - src/app/(app)/incidents/actions.ts
    - src/app/(app)/settings/notifications/history/page.tsx
---

# Respond to your first incident

Finish the newcomer journey by responding exactly as an on-call engineer would, then verify the delivery and audit trail.

## Before you begin

Sign in as the responder targeted by the test policy and send the trigger from [Receive your first alert](./receive-first-alert). Keep the provider event available so you can send recovery after the manual exercise.

## 1. Verify notification delivery

Open the notification on the configured channel. Confirm its incident title, service, urgency, and link all match the test event. If the provider supports an acknowledgement action, you may use it; otherwise open OpsKnight from the link.

In OpsKnight, open **Settings → Notifications → History** and locate the delivery. Distinguish a queued attempt from a provider-confirmed success. A queued record proves acceptance by OpsKnight, not receipt by the destination.

## 2. Inspect and acknowledge

1. Open **Incidents** and select the triggered incident.
2. Review its service, priority, urgency, description, source, creation time, SLA state, and timeline.
3. Select **Acknowledge**.
4. Confirm the status and timeline record the acknowledgement and active escalation no longer advances.

Acknowledgement means response has begun. It does not assign long-term ownership or resolve the underlying condition.

## 3. Assign and communicate

Assign the incident to the test responder when explicit ownership is needed. Add an investigation note stating that this is a quickstart test and record what was verified. If ChatOps is configured, confirm the incident card updates; do not create a production war room for this exercise.

Expected result: assignment and notes appear as separate timeline events. Assignment does not replace acknowledgement.

## 4. Resolve the incident

1. Select **Resolve**.
2. Enter a useful summary, for example `Quickstart webhook and responder delivery verified; no production impact`.
3. Confirm resolution.
4. Verify the incident is **Resolved**, the timeline retains creation, acknowledgement, assignment, notes, and resolution, and no later policy step fires.

If you also send provider recovery, use the same correlation identity. Repeated recovery should converge safely rather than create another incident.

## 5. Review the operational evidence

Check the incident delivery details and notification history for each attempted channel. Confirm the policy target and resolved responder were the ones expected. An Admin can also review **Audit Logs** for the configuration and lifecycle actions performed during setup.

The newcomer journey is complete only when all of these are true:

- the external event created one incident on the correct service;
- the attached policy resolved to the expected responder;
- at least one notification reached its destination;
- acknowledgement stopped escalation;
- resolution closed the incident with a useful timeline.

## If a step fails

Use the focused guides for [acknowledgement](../guides/incidents/acknowledge), [assignment](../guides/incidents/assign), [resolution](../guides/incidents/resolve), [delivery inspection](../guides/notifications/inspect-delivery), and [notification troubleshooting](../troubleshooting/notifications/not-delivered).
