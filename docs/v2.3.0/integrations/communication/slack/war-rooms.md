---
title: Operate Slack incident war rooms
order: 10
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

Open **Incidents → select incident** and locate the **Create war room** launcher in the incident command bar. A war room is incident-scoped, not a routine service destination.

## Configure the room

Confirm the Slack provider/workspace, intended public or private channel behavior, incident, and participants. Private rooms require the optional group scopes.

## Complete the action

1. Select **Create war room** in the incident command bar.
2. Confirm Slack as the provider in the dialog and create the war room.
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

## Squire in the incident channel

When Squire is enabled for chat (**Settings → Intelligence → AI**, the assistant
and its chat switch), it works inside the war-room channel:

- **Ask or investigate.** Mention the app (`@OpsKnight what changed?`), or type
  `@Squire …` as plain text at the start of a message. `@OpsKnight investigate`
  (optionally `investigate <focus>`) runs Squire's investigation on the
  channel's incident. Squire replies in the thread, edits that reply with its
  progress, and ends with the investigation and links to the evidence.
  `/incident investigate [focus]` does the same privately. Squire answers as the
  asker's linked OpsKnight account: an unlinked Slack account, or a person who
  cannot read the incident in OpsKnight, is refused.
- **Automatic updates.** Squire keeps one incident summary and one
  investigation message in the channel and edits them in place as they change;
  an unchanged update is not re-sent. Digests and fix verifications are posted
  as replies in the investigation's thread (or the summary's). Updates go only
  to the incident's live war room, never to a service alert channel, and are
  skipped when ChatOps or the Slack installation is disabled. Slack rate limits
  pause updates for that channel briefly instead of retrying in a loop.
- **Identity.** With the optional `chat:write.customize` scope, Squire posts
  under its own name and avatar; otherwise its messages start with a Squire
  header. See [permissions and scopes](./permissions-and-scopes).

## Troubleshooting

**Creation forbidden:** verify `channels:manage`; private rooms also need the documented `groups:*` permissions and bot access.

**Room exists but operation is ambiguous:** inspect durable room ID/operation and provider response before retrying.

**Membership or actions fail:** check user availability, identity mapping, bot membership, scopes, and product authorization.

## Next steps

- [Use incident actions](./acknowledge-resolve)
- [Troubleshoot Slack](./troubleshooting)
