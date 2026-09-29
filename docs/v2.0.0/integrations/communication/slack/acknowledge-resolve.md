---
title: Acknowledge and resolve incidents from Slack
description: Use Slack message actions safely and verify incident, escalation, timeline, and message convergence.
type: how-to
product_area: chatops
audience: [responder]
keywords: [Slack acknowledge, Slack resolve, incident action]
reader:
  status: READER_COMPLETE
  task: Acknowledge and resolve an OpsKnight incident from Slack.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/api/slack/actions/route.ts, src/lib/chatops/]
---

# Acknowledge and resolve incidents from Slack

## Before you begin

Connect Slack, configure the service channel, and [link your responder identity](./user-identity-linking). You need product permission to perform the action and an incident in a valid starting state.

## Open the feature

Open the incident's Slack message in a routine destination or war room. Use the action on the current message rather than an old copied link or screenshot.

## Configure the action

For acknowledgement, confirm the incident is open/triggered and you intend to stop or alter active escalation according to the incident policy. For resolution, confirm the incident is actually mitigated and supply a meaningful summary when prompted.

## Complete the action

1. Select **Acknowledge** or **Resolve** on the incident message.
2. Complete identity linking if prompted, then retry once.
3. For resolution, enter the requested summary.
4. Wait for the card/message update instead of clicking repeatedly.

## What OpsKnight does

OpsKnight validates the signed Slack request, timestamp, workspace, action schema, identity, authorization, and current incident transition. It updates the authoritative incident/timeline, applies escalation/notification effects, and reconciles all provider projections.

Concurrent or stale actions are evaluated against current incident state. A Slack click cannot bypass product lifecycle rules.

## Verify it worked

Open the OpsKnight incident and confirm status, actor attribution, timeline entry, assignee/escalation effect, and any resolution summary. Confirm every mapped Slack projection converges to the same state.

## Change or undo the action

Acknowledgement and resolution are lifecycle events, not editable Slack text. Use the supported OpsKnight incident transition or reopen/follow-up workflow where available; do not manually edit the message to imply a different state.

## Troubleshooting

**Identity prompt repeats:** ensure the signed link was completed while signed in as the matching active OpsKnight user, then remove stale mapping if needed.

**Forbidden:** verify product permissions/service scope and that the action is valid for the current state.

**Slack times out but action may have applied:** inspect the OpsKnight incident/timeline and operation before retrying to avoid duplicate intent.

## Next steps

- [Use Slack commands](./commands)
- [Operate war rooms](./war-rooms)

