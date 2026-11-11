---
title: Use Intelligence suggestions and the assistant
description: Read similar incidents, possible causes and runbook suggestions on an incident, rate them, and ask the assistant.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Use the suggestions on an incident page and ask the assistant about an incident.
verification:
  level: test
  verified_at: 2026-11-11
  evidence:
    [
      src/components/incident,
      src/components/squire,
      tests/components/squire/SquireChatPolish.test.tsx,
      tests/e2e/intelligence-ui.spec.ts,
    ]
---

# Use Intelligence suggestions and the assistant

An incident page keeps its own content first: title, status, actions, description, notes and timeline
stay where they are. Intelligence is one row of chips under the action bar, the **strip**, and one panel
you open on demand, **Insights**.

## The strip and the Insights panel

The strip shows a chip only when there is something to say, for example **Triage: urgency HIGH**,
**3 similar**, **Likely cause: deploy api v9**, **Suppressed by rule X**, **Impact: 4 services, SLO
burning** or **Briefing ready**. When there is nothing to say there is no strip. On a phone the strip
scrolls sideways.

Select a chip to open **Insights** at that section. You can also press **I** anywhere on the incident
(press it again to close), or share a link that ends in `?insights=similar` (or `briefing`, `triage`,
`related`, `why`, `runbooks`, `impact`, `summary`). On a desktop the panel sits on the right, does not
block the page behind it, and can be resized by dragging its left edge or with the arrow keys on the
resize handle; the width is remembered in this browser. On a phone it opens as a sheet from the bottom.

A small dot at the end of the strip appears only while analysis is waiting, out of date, paused or
failed. Select it to read why; intelligence managers can refresh the analysis from there.

Insights has up to eight sections, always in this order, and a section with nothing to show is left
out: Briefing, Triage, Similar, Related and group, Why, Runbooks, Impact, Summary. When enabled for the
service, they can show:

- **Similar past incidents**, with a match score and the reasons for the match. The score ranks suggestions;
  it is not a probability. "Similar meaning" means the titles describe the same problem in different words
  (shown only when your administrator has turned on semantic search).
- **Related incidents**, linked by a grouping rule or by a responder. Use **Group these** to confirm a suggestion, reject it, or unlink it. Certified automatic groups
  show **Ungroup**, which records an undo and prevents automatic replay.
- **Possible causes**: recent changes on this service or a service it depends on, and incidents upstream.
  These are leads to check, not conclusions.
- **Runbooks that have worked here**, with how often each succeeded. **Run on this incident** opens the existing runbook preview with that runbook selected; inputs, targets
  and native approvals still apply before execution.

You only ever see suggestions about incidents, services and runbooks you can already open.

Expand **Why this matched** to inspect match reasons. **Mark related** links a precedent through the
normal visibility and feedback permissions.

Each item has an **Ask** button labelled with your assistant's name (for example **Ask Squire**). It
opens the assistant with a question about that one item already asked.

When intelligence is off for the service, responders see no strip, no chips and no Insights panel.
Intelligence managers can still open Insights with **I**: it says intelligence is off and keeps the
links and groups made before it was turned off, so a wrong grouping can still be undone.

## Suggested runbooks

Runbooks that have worked on similar incidents appear as **Suggested for this incident**, with their
success rate, at the top of the incident's **Runbooks** tab. The Runbooks section of Insights links
there.

## Triage chips

When an administrator has turned on **Suggest triage** for your service, the **Triage** section shows
chips derived from how similar incidents were handled: a suggested urgency, a suggested owner, a probable
duplicate, and the usual time to resolve. **Apply** runs the same action you would take by hand (the change
appears in the timeline); **Dismiss** records that the suggestion was wrong. Nothing is applied on its own,
and the percentage is a match strength from past incidents, not a probability.

## Intelligence events on the timeline

The incident's **Timeline** tab has a **Show intelligence events** switch. It is on whenever such events
exist and adds recorded changes (with their risk score), incidents on upstream services, noise-control
decisions and suggestion history as rows of the same timeline, so you can see what changed just before
the incident started. The **Intelligence** filter shows only those rows. Turn the switch off to see the
core timeline alone.

## Impact

The **Impact** section estimates who else this incident affects:

- **Dependent services**: services that depend on this one in the active dependency graph (up to three hops),
  with their current status and how many open incidents they have. Only services you can open are listed,
  and a dependency that runs through a service you cannot open is not followed.
- **Status-page components** that show this service or a dependent one, with their current status, and a
  note when the status page is not published.
- **Error budget at risk**: for each availability or uptime objective on the service, the 1 hour and 6 hour
  burn rates and roughly how much of the objective's error budget this incident has used so far. This part
  needs global metrics access, because the burn counts every incident on the service.

It is an estimate to check, not a measurement. When nothing applies the section is left out.

## Rate a suggestion

Use the thumbs next to a similar incident. If it was not helpful, pick a reason. Your rating is yours to change
or withdraw. Ratings help administrators tune how strict matching is.

## Ask the assistant

The assistant (named by your administrator, Squire by default) opens from:

- the **Ask** button in the corner,
- the keyboard shortcut **⌘ J** (macOS) or **Ctrl J** (Windows and Linux), from any page; press it again to
  close the assistant. It is listed on the **Keyboard Shortcuts** page,
- **Ask** in global search,
- the **Ask** button on any item in an incident's Insights panel, which asks about that item.

On an incident page it knows which incident you mean. Ask things like "have we seen this before?", "what could
have caused this?" or "which runbook fits?".

- It can only read what you can read. For changes such as acknowledge, resolve, add a note, reassign or
  mark related, it proposes an action card. Read it and select **Confirm**; nothing happens before
  confirmation. Each card links to the affected incident and shows its confirmation deadline; expired
  suggestions need to be requested again. Changed assignments, incident generations or relationship
  decisions also require fresh review. Runbook and postmortem cards open their normal review workflows.
- If confirmation loses its response, choose **Check result**. This only reads the existing result; it
  never repeats the action. Completed outcomes survive closing and reopening the panel, including after
  the suggestion expires. If the result is unknown, inspect the incident before requesting another
  action. Result lookup is available for one day and still requires access to the incident.
- "Basic answer from your incident data" means AI is off or unavailable, and the answer comes straight from the
  suggestions above. AI chat also requires a provider approved for Personal data; when none is available,
  the assistant explains the restriction and keeps your conversation out of the model.
- Select **Stop response** to stop a long answer. Text already received stays available for a follow-up.
  If a response is interrupted, the assistant keeps the partial answer and tells you it is incomplete.
- Treat AI answers as a starting point and check them.
- Conversations are not saved unless your administrator has turned saved conversations on. Then the clock
  button lists yours: only you can see them, you can reopen or delete any of them, and they are deleted
  automatically after a period without use. An incident conversation must be continued on its original
  incident; a global conversation must be continued outside an incident. Opening one from another context
  explains this instead of relabeling its history. Otherwise **New chat** or reloading the page clears them.
- Press **Escape** to close it. While it is open, **Tab** and **Shift Tab** move only between its own controls;
  closing it returns you to where you were. Screen readers hear what it is looking up while it works and
  when the answer is complete. The arrows button moves it to the other side of the screen; your choice is
  remembered in this browser.

### When the assistant cannot use AI

A strip under the assistant's header says why, and what you can do:

| Strip                           | Meaning                                                                                                             | What to do                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Too many requests**           | You sent many questions in a short time.                                                                            | Wait for the countdown, then select **Retry**.                                        |
| **Daily AI budget reached**     | Your organization used today's AI budget (it resets at 00:00 UTC). Answers come from your incident data until then. | Administrators see **Review AI budget**; others can ask an administrator to raise it. |
| **AI is off · basic mode**      | AI has not been turned on. Answers come from your incident data.                                                    | Administrators see **Turn on AI**.                                                    |
| **Basic mode · AI unavailable** | AI is on but could not answer this time (no approved provider, or the provider failed).                             | Select **Retry with AI**.                                                             |

## Summaries and postmortem drafts

When AI is set up for it, the **Summary** section of Insights offers **Summarise this incident**: it writes
a short summary of what happened so far, the current state and suggested next steps. **Post summary as
note** adds it to the incident's notes. **Insert summary** in the note box's toolbar drafts the same
summary into the note for you to edit before posting. In the postmortem editor, **Draft with AI**
fills in sections that are still empty and proposes action items. Nothing is saved until you save the
postmortem, and you should edit the draft: it only knows what is recorded on the incident.

For supported operational questions, product guidance, reporting windows and query limits without a provider, see [Use Squire without an AI provider](./basic-mode.md).
