---
title: Use Slack incident actions
order: 7
description: Acknowledge, resolve, annotate, and inspect incidents from Slack.
type: concept
product_area: chatops
audience: [responder]
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/app/api/slack/actions/route.ts
    - src/lib/chatops/slash-commands.ts
    - src/lib/slack/incident-card.ts
    - src/lib/slack/app-manifest.ts
    - tests/api/slack-actions-lifecycle.test.ts
---

# Use Slack incident actions

This page summarizes the supported action surface. Follow [Acknowledge and resolve incidents](./acknowledge-resolve) for lifecycle effects and [Slack incident commands](./commands) for exact slash-command behavior.

## Before you begin

Connect Slack, map a service destination, and link your responder identity.

Interactive messages expose only actions allowed by the shared ChatOps policy.
Link your Slack identity before performing user-attributed actions.

1. Open the incident message or incident war-room channel.
2. Use a button on the message, or enter `/incident` with one of the commands below.

The channel card offers these buttons, depending on the incident's state:

| Button | What it does |
| --- | --- |
| **Acknowledge** | Acknowledges the incident as you. |
| **Resolve** | Resolves the incident after you confirm the dialog. |
| **Snooze…** | A menu for 15 minutes, 1 hour, or 4 hours. The card shows **Snoozed until**. |
| **Escalate** | Pages the next escalation level now, after you confirm the dialog. Shown only while the incident is open. |
| **Assign to me** | Assigns the incident to you. |
| **View in OpsKnight** | Opens the incident. |

![A snoozed incident card with the Snoozed until field and the buttons that still apply](/docs/v2.3.0/assets/slack-incident-card-snoozed.png)

Slash commands: `declare`, `list [service]`, `oncall [service]`, `ack`, `resolve [summary]`, `note <text>`, `who`, `postmortem`, `ask <question>`, `investigate`, and `help`. See [Slack incident commands](./commands).

If OpsKnight refuses an action (for example you have no linked account, or the incident is no longer open), you get a private message and the card is left exactly as it was. Nobody else sees the refusal and the shared card is never replaced by it.

3. Confirm the incident timeline and Slack message show the resulting state.

After an action, confirm the OpsKnight incident timeline and the original Slack
message converge on the same state. Inbound actions require valid Slack request
signatures and timestamps and still pass OpsKnight authorization checks.
