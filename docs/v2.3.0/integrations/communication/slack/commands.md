---
title: Use Slack incident commands
order: 11
description: Run supported signed slash commands and verify their authoritative OpsKnight incident effects.
type: how-to
product_area: chatops
audience: [responder]
keywords: [Slack slash commands, incident command]
reader:
  status: READER_COMPLETE
  task: Use and verify supported Slack incident commands.
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/lib/chatops/slash-commands.ts
    - src/lib/slack/app-manifest.ts
    - src/app/api/slack/commands/route.ts
    - tests/lib/chatops-slash-commands.test.ts
    - tests/api/slack-commands-ack.test.ts
---

# Use Slack incident commands

## Before you begin

Install the current Slack app manifest, link your identity, and open an incident destination/war room where the command context is clear.

## Open the feature

In Slack's message composer, enter `/incident help` to display the supported command syntax.

## Configure the command

Three commands work in **any** channel; the rest work in an incident war room:

| Command | What it does |
| --- | --- |
| `/incident declare` | Opens a form to declare a new incident (see below). |
| `/incident list [service]` | Your open incidents, or a service's. If none are assigned to you, it shows the latest open incidents you can see and says so. |
| `/incident oncall [service]` | Who is on call for a service. |
| `/incident ack` | Acknowledges the incident. |
| `/incident resolve [summary]` | Resolves the incident, optionally with a summary. |
| `/incident note <text>` | Adds a note to the timeline. |
| `/incident who` | Roles and on-call chain for the incident. |
| `/incident role <commander\|ops-lead\|comms-lead\|scribe> @person\|me\|clear` | Assigns or clears an incident role. |
| `/incident postmortem` | Starts a postmortem. |
| `/incident help` | Lists the commands. |

![The private reply to /incident who, listing the incident roles and the on-call chain](/docs/v2.3.0/assets/slack-command-who.png)

When Squire is enabled for chat, `ask <question>` and `investigate [focus]` answer privately about the channel's incident, under your linked account's access. Provide required text and avoid sensitive information in notes/summaries.

## Complete the action

1. Enter `/incident <command>` with its argument.
2. Submit once and read the response.
3. Complete identity linking if prompted.
4. Open OpsKnight when the response says the action was queued or cannot confirm final state.

## Declare an incident from Slack

`/incident declare` opens a form with the same choices as the web create page:

![The Slack declare form with title, service, urgency, priority, visibility, assignee, and description](/docs/v2.3.0/assets/slack-declare-form.png)

- **Title** and **Service** are required. The service list is searchable.
- **Urgency** defaults to High.
- **Priority** is optional. Left empty, the service's policy sets it, as on the web.
- **Visibility** is optional: customer-facing (status pages) or internal only. Left empty, the service's default applies.
- **Assign to** is optional and is a Slack person picker. OpsKnight maps the person to an OpsKnight user by email. If they have no matching account, the incident is still declared, the on-call policy assigns it, and the reply says so.
- **Description** is optional.

OpsKnight checks that you may declare incidents on that service, using your linked account, before it creates anything. If the declaration matches an open incident, it is added there instead of creating a duplicate.

## How a command answers

A fast command shows only its answer, with no "Processing" note. Who sees the answer depends on the command:

- **Private to you:** the read-only commands (`who`, `list`, `oncall`, `help`), `ask` and `investigate`, and any error or refusal.
- **Posted in the channel:** commands that change the incident (`ack`, `resolve`, `note`, `role`, and `postmortem`) announce the result to everyone in the channel, including a resolution summary or the text of a note. Keep that in mind before putting sensitive details in them.

Commands that can take many seconds (`ask`, `investigate`, `postmortem`) first show a short "Working on it…" note so you know the request arrived.

## What OpsKnight does

OpsKnight validates the Slack signature/timestamp, parses only the supported grammar, maps identity, checks authorization/context, and applies the same product transition used by the UI.

## Verify it worked

Confirm the authoritative incident timeline/state/actor in OpsKnight and the updated Slack projection. For `who`, confirm the reported ownership matches current OpsKnight state.

## Change or undo the command

Commands create product actions; deleting Slack command text does not undo them. Use the supported incident workflow to correct state or add a clarifying note.

## Troubleshooting

**Command not recognized:** use `/incident help` and confirm the current app package registered the command.

**Wrong incident/context:** open the intended incident message/war room and retry only after confirming no action applied.

**Temporary queue error:** inspect OpsKnight worker health and operation state before retrying.

## Next steps

- [Acknowledge and resolve](./acknowledge-resolve)
- [Troubleshoot Slack](./troubleshooting)

