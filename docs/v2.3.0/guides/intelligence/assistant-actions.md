---
title: Confirm actions the assistant suggests
description: Turn on extended assistant actions and confirm escalations, urgency changes, snoozes, watchers, Jira issues, status updates, runbook runs and changes beyond incidents (overrides, maintenance windows, services) from Squire.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Enable extended assistant actions and review and confirm the cards Squire offers.
verification:
  level: test
  verified_at: 2026-11-08
  evidence:
    [
      src/lib/intelligence/squire/actions,
      src/components/squire/SquireProposalCard.tsx,
      tests/integration/intelligence/squire-extended-actions.test.ts,
      src/lib/intelligence/squire/operations.ts,
      tests/integration/intelligence/squire-operations.test.ts,
    ]
---

# Confirm actions the assistant suggests

Squire never changes anything by itself. When it suggests an action it shows a **card** that says
exactly what will happen. Nothing happens until you press the card's button, and the change then runs
with your own permissions, through the same code as the matching button in OpsKnight, and is audited.

By default Squire can suggest acknowledging, resolving, adding a note, reassigning and marking incidents
as related. An administrator can add more.

## Turn on extended actions (administrators)

1. Open **Settings → Intelligence → Assistant**.
2. Select **Extended assistant actions** and save.

Turning it off again withdraws any card that is still open: confirming it then reports that the action is
turned off.

## What the extended actions do

| Card                                        | What happens when you confirm                                                                                                                                                                                      | Who can confirm                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Escalate now**                            | Pages the next level of the incident's escalation policy now. The card names the level and who it pages. Only for open incidents.                                                                                  | Anyone allowed to escalate the incident                                 |
| **Change urgency**                          | Sets the urgency to high, medium or low, with the same timeline entry and engagement rules as the urgency control.                                                                                                 | Responders and administrators                                           |
| **Snooze incident**                         | Snoozes for 5 minutes to 24 hours, with an optional reason. It reopens automatically. Use the incident page for longer.                                                                                            | Responders and administrators                                           |
| **Remove related link**                     | Stops treating two incidents as related. The history keeps the link.                                                                                                                                               | People who can give Intelligence feedback                               |
| **Add a watcher**                           | Adds a person as follower, stakeholder or exec.                                                                                                                                                                    | Responders and administrators; others can follow an incident themselves |
| **Create a Jira issue**                     | Creates and links an issue in the service's Jira project. Only offered when Jira is configured for the service and no issue is linked yet.                                                                         | Responders and administrators                                           |
| **Draft a status update** (step 1 of 2)     | Saves an unpublished draft on the status page. It is not shown and no subscriber is notified.                                                                                                                      | Administrators                                                          |
| **Publish the status update** (step 2 of 2) | Appears after the draft is saved. Publishes it on the status page. Subscribers are not notified from here.                                                                                                         | Administrators                                                          |
| **Run runbook**                             | Starts a runbook that is bound to the incident's service. Its own approval steps still apply; follow or cancel it on the incident's **Runbooks** tab. Runbooks that need inputs are started from that tab instead. | Anyone allowed to run runbooks                                          |

Cards for paging, other systems, public pages and automation carry a line saying so. Squire offers only
the cards you could use yourself, and never to API keys.

Without AI (basic mode), on an incident page you can ask for the simple ones directly: "escalate this",
"set urgency to low", "snooze this for 2 hours".

## If a card is refused

- **Expired**: cards are valid for 10 minutes. Ask again.
- **The incident changed after this suggestion was prepared**: someone acknowledged it, changed the
  urgency, edited the draft, reconfigured the runbook binding, and so on. Review the incident and ask for a
  fresh card.
- Pressing the button twice, or reloading, never repeats the action: the card shows the recorded result.
  If the result is unknown (for example the connection dropped while paging), check the incident before
  asking for another card.

## Changes beyond incidents

With extended actions on, Squire can also suggest changes outside an incident, such as adding a schedule
override, creating a maintenance window, renaming a service or setting its escalation policy, tagging an
incident, editing a postmortem, or updating an SLO, a dashboard or a status page. It finds the operation in
the same reviewed API catalog the MCP server uses, and you get a card with:

- what the change is, and a **before → after** line for each field it sets (where the current value can
  be read);
- **Apply change**, which runs that API operation once, as you: the same validation, role checks and
  audit as if you had called the API yourself;
- **Open in OpsKnight**, to review the record first.

Only operations your role already allows are offered. Credentials, webhook and integration settings,
notification delivery, sensitive reads and every high-risk operation (deletes, credential rotation, user
administration) are never reachable from Squire. These cards can only be confirmed in the web app, not
from Slack or Teams.

Squire can also read through the same catalog (for example a schedule's overrides or a maintenance
window) when no dedicated lookup exists. Those reads use your permissions and the same field allowlist and
redaction as MCP.
