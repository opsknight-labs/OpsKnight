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
  verified_at: 2026-11-10
  evidence:
    [
      src/components/incident,
      src/components/squire,
      tests/components/squire/SquireChatPolish.test.tsx,
      tests/e2e/intelligence-ui.spec.ts,
    ]
---

# Use Intelligence suggestions and the assistant

Open the **Intelligence** panel on an incident. Its tabs show Similar, Related, Causes & runbooks,
Timeline, Impact, Summary and Ask Squire. Tabs support arrow keys and scroll within the panel on phones. When enabled
for the service, they can show:

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
normal visibility and feedback permissions. Empty tabs explain OFF, shadow mode or pending analysis.

## Triage chips

When an administrator has turned on **Suggest triage** for your service, the **Similar** tab also shows
chips derived from how similar incidents were handled: a suggested urgency, a suggested owner, a probable
duplicate, and the usual time to resolve. **Apply** runs the same action you would take by hand (the change
appears in the timeline); **Dismiss** records that the suggestion was wrong. Nothing is applied on its own,
and the percentage is a match strength from past incidents, not a probability.

## Timeline tab

**Timeline** lines up this incident's alerts, recorded changes (with their risk score), incidents on upstream
services and any noise-control decisions relative to when the incident opened, so you can see what changed
just before it started.

## Impact tab

**Impact** estimates who else this incident affects:

- **Dependent services**: services that depend on this one in the active dependency graph (up to three hops),
  with their current status and how many open incidents they have. Only services you can open are listed,
  and a dependency that runs through a service you cannot open is not followed.
- **Status-page components** that show this service or a dependent one, with their current status, and a
  note when the status page is not published.
- **Error budget at risk**: for each availability or uptime objective on the service, the 1 hour and 6 hour
  burn rates and roughly how much of the objective's error budget this incident has used so far. This part
  needs global metrics access, because the burn counts every incident on the service.

It is an estimate to check, not a measurement. When nothing applies the tab says so.

## Rate a suggestion

Use the thumbs next to a similar incident. If it was not helpful, pick a reason. Your rating is yours to change
or withdraw. Ratings help administrators tune how strict matching is.

## Ask the assistant

The assistant (named by your administrator, Squire by default) opens from:

- the **Ask** button in the corner,
- the keyboard shortcut **⌘ J** (macOS) or **Ctrl J** (Windows and Linux), from any page; press it again to
  close the assistant. It is listed on the **Keyboard Shortcuts** page,
- **Ask** in global search,
- the **Ask** panel on an incident page, which offers ready-made questions about that incident.

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

When AI is set up for it, an incident page offers **Summarise this incident**: it writes a short summary of what
happened so far, the current state and suggested next steps. In the postmortem editor, **Draft with AI**
fills in sections that are still empty and proposes action items. Nothing is saved until you save the
postmortem, and you should edit the draft: it only knows what is recorded on the incident.

For supported operational questions, product guidance, reporting windows and query limits without a provider, see [Use Squire without an AI provider](./basic-mode.md).
