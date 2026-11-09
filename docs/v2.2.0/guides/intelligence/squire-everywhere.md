---
title: Ask Squire in Slack, Microsoft Teams, MCP and on mobile
description: Turn on Squire outside the web app, ask it in incident channels and war rooms, confirm its suggestions with a button, and use ask_squire from an AI assistant.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Enable and use Squire in Slack, Microsoft Teams, MCP clients and the mobile incident page.
verification:
  level: test
  verified_at: 2026-11-08
  evidence:
    [
      src/lib/chatops/squire,
      src/lib/mcp/core/ask-squire.ts,
      src/components/squire/MobileSquireMount.tsx,
      tests/integration/intelligence/squire-chat-surfaces.test.ts,
      tests/unit/chatops-squire-render.test.ts,
      tests/components/squire/SquireMobile.test.tsx,
      tests/mcp/tools-list-contract.test.ts,
    ]
---

# Ask Squire in Slack, Microsoft Teams, MCP and on mobile

Squire answers the same way everywhere: in basic mode without AI, or with AI when a provider is configured. It always uses **your own OpsKnight permissions**, cites what it relied on, and never changes anything until you confirm a suggestion yourself.

## Turn it on

An administrator opens **Settings → Intelligence → Assistant & AI**. The assistant itself must be on. Under **Assistant outside the web app**, each surface has its own switch, all off by default:

| Switch                                  | What it adds                                                                |
| --------------------------------------- | --------------------------------------------------------------------------- |
| **Slack and Microsoft Teams**           | `@squire` in incident channels and war rooms, and `/incident ask` in Slack. |
| **AI assistants over MCP (ask_squire)** | The read-only `ask_squire` tool for connected assistants.                   |
| **Mobile incident pages**               | The assistant, full screen, on `/m/incidents/…`.                            |

Turning a switch off stops new questions at once. Suggestions already shown in chat can no longer be confirmed.

## Slack

In an OpsKnight incident channel:

- **`@squire what changed before this started?`** Squire replies in the thread, visible to the channel.
- **`/incident ask is this related to yesterday's outage?`** Squire replies only to you.

Your Slack account must match an active OpsKnight account by its verified email address, as for the other `/incident` commands. Otherwise Squire tells you it cannot answer for you. Squire answers only in incident channels; elsewhere it points you to OpsKnight.

The Slack app needs the `app_mentions:read` event subscription for `@squire`. The existing interactivity URL handles the buttons.

## Microsoft Teams

In an incident war room, mention the OpsKnight bot with your question. Squire replies in the thread. Your Teams account must be linked to OpsKnight (automatically through Entra ID, or with the account-link prompt the incident cards show). Squire answers only in incident war rooms.

## Confirm a suggestion from chat

When Squire suggests a change (for example "Acknowledge the incident"), the reply carries **Confirm** and **Dismiss** buttons (Slack) or a **Confirm** action (Teams).

- **Only the person who asked can confirm.** Anyone else gets a private message and nothing changes.
- Confirming runs the same command and permission checks as the button in OpsKnight. If the incident changed since the suggestion, or your access changed, nothing happens and you are told why.
- A success message is posted only after OpsKnight recorded the result. Clicking twice does not repeat the change.
- Suggestions expire after 10 minutes. Ask again for a fresh one.
- A suggestion that read alert or note text is marked: check that content before confirming.
- A long resolution or note does not fit in a Slack button. Squire then shows **Open in OpsKnight** instead.

Each person can ask 6 questions and confirm 20 suggestions per minute across Slack and Teams.

## MCP: ask_squire

With the MCP switch on, an AI assistant connected to OpsKnight sees an `ask_squire` tool, if its connection was granted the read permissions for incidents, services, schedules, teams, runbooks and postmortems. Pass a `question` and optionally an `incidentId`.

The tool is read-only. Suggested actions come back as descriptions with a link (`executed: false`); a person confirms them in OpsKnight. Answers are limited to 10 per minute per person. See the [MCP tool reference](../../reference/mcp/tools.md).

## Mobile

With the mobile switch on, an **Ask Squire** button appears on mobile incident pages. It opens full screen and already knows which incident you are looking at.

## Page context in the web app

Squire knows the page you opened it on: an incident, service, team, schedule, runbook, alert or change. On a change page, "this service" means the service the change was recorded on. A page you cannot read is ignored.
