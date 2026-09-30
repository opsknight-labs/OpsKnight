---
title: Operate Slack incident war rooms
description: Create, synchronize, and close incident-scoped Slack channels.
type: how-to
product_area: chatops
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Create, verify, reconcile, and close a Slack incident war room.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/war-room/providers/slack/adapter.ts, src/lib/chatops/war-room.ts]
---

# Operate Slack incident war rooms

## Before you begin

Connect Slack with the required public or private-channel scopes and create an
active incident.

## Open the feature

Open **Incidents → select incident → Collaboration → Create war room**. A war room is incident-scoped, not a routine service destination.

## Configure the room

Confirm the Slack provider/workspace, intended public or private channel behavior, incident, and participants. Private rooms require the optional group scopes.

## Complete the action

1. Open the incident collaboration controls.
2. Select the Slack provider and create the war room.
3. Confirm the context and intended participants appear.
4. Close the room from OpsKnight when coordination is complete.

## What OpsKnight does

OpsKnight creates or links a provider room, stores durable identity, publishes incident context with idempotent delivery keys, reconciles participants/messages, and performs terminal cleanup. The incident remains authoritative.

## Verify it worked

Verify channel creation, topic/initial context, participant synchronization,
interactive actions, pinned-note behavior, and closure. Missing
`channels:manage` prevents public-channel lifecycle operations; private rooms
also require the optional group scopes described in
[permissions and scopes](./permissions-and-scopes).

## Remove or change the room

Close/reconcile through OpsKnight instead of manually deleting the Slack channel. If a remote room was changed/deleted, inspect the collaboration operation before retrying to avoid duplicate rooms.

## Troubleshooting

**Creation forbidden:** verify `channels:manage`; private rooms also need the documented `groups:*` permissions and bot access.

**Room exists but operation is ambiguous:** inspect durable room ID/operation and provider response before retrying.

**Membership or actions fail:** check user availability, identity mapping, bot membership, scopes, and product authorization.

## Next steps

- [Use incident actions](./acknowledge-resolve)
- [Troubleshoot Slack](./troubleshooting)
