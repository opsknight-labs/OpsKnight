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
  verified_at: 2026-10-28
  evidence: [src/components/incident, src/components/squire, tests/e2e/intelligence-ui.spec.ts]
---

# Use Intelligence suggestions and the assistant

When an administrator has turned Intelligence on for a service, its incident pages can show:

- **Similar past incidents**, with a match score and the reasons for the match. The score ranks suggestions;
  it is not a probability. "Similar meaning" means the titles describe the same problem in different words
  (shown only when your administrator has turned on semantic search).
- **Related incidents**, linked by a grouping rule or by a responder. You can confirm, reject or unlink them.
- **Possible causes**: recent changes on this service or a service it depends on, and incidents upstream.
  These are leads to check, not conclusions.
- **Runbooks that have worked here**, with how often each succeeded. Opening one takes you to the runbook; nothing
  runs from the suggestion.

You only ever see suggestions about incidents, services and runbooks you can already open.

## Rate a suggestion

Use the thumbs next to a similar incident. If it was not helpful, pick a reason. Your rating is yours to change
or withdraw. Ratings help administrators tune how strict matching is.

## Ask the assistant

The assistant (named by your administrator, Squire by default) opens from:

- the **Ask** button in the corner,
- **Ask** in global search,
- the **Ask** panel on an incident page, which offers ready-made questions about that incident.

On an incident page it knows which incident you mean. Ask things like "have we seen this before?", "what could
have caused this?" or "which runbook fits?".

- It can only read what you can read, and it **cannot change anything**. Use the incident page to acknowledge,
  resolve or run a runbook.
- "Basic answer from your incident data" means AI is off or unavailable, and the answer comes straight from the
  suggestions above.
- Treat AI answers as a starting point and check them.
- Conversations are not saved unless your administrator has turned saved conversations on. Then the clock
  button lists yours: only you can see them, you can reopen or delete any of them, and they are deleted
  automatically after a period without use. Otherwise **New chat** or reloading the page clears them.
- Press **Escape** to close it. The arrows button moves it to the other side of the screen; your choice is
  remembered in this browser.

## Summaries and postmortem drafts

When AI is set up for it, an incident page offers **Summarise this incident**: it writes a short summary of what
happened so far, the current state and suggested next steps. In the postmortem editor, **Draft with AI**
fills in sections that are still empty and proposes action items. Nothing is saved until you save the
postmortem, and you should edit the draft: it only knows what is recorded on the incident.
