---
title: Operate Slack incident war rooms
description: Create, synchronize, and close incident-scoped Slack channels.
type: how-to
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/war-room/providers/slack/adapter.ts, src/lib/chatops/war-room.ts]
---

# Operate Slack incident war rooms

## Before you begin

Connect Slack with the required public or private-channel scopes and create an
active incident.

A war room is an incident-scoped Slack channel, not a routine service
destination. Create it from the incident collaboration controls. OpsKnight
projects incident context into the room, reconciles participants, and performs
terminal cleanup when the room closes.

1. Open the incident collaboration controls.
2. Select the Slack provider and create the war room.
3. Confirm the context and intended participants appear.
4. Close the room from OpsKnight when coordination is complete.

Verify channel creation, topic and initial context, participant synchronization,
interactive actions, pinned-note behavior, and closure. Missing
`channels:manage` prevents public-channel lifecycle operations; private rooms
also require the optional group scopes described in
[permissions and scopes](./permissions-and-scopes).
