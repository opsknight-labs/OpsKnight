---
title: Use Squire without an AI provider
description: Ask permission-scoped operational questions and get product guidance in basic mode.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Ask operational questions and understand reporting limits without an AI provider.
verification:
  level: test
  verified_at: 2026-11-06
  evidence:
    [
      src/lib/intelligence/squire/basic,
      tests/unit/intelligence-squire-basic-query.test.ts,
      tests/unit/intelligence-squire-nlu.test.ts,
      tests/integration/intelligence/squire-basic-capabilities.test.ts,
      tests/integration/intelligence/squire-basic-v2.test.ts,
      tests/integration/intelligence/squire-evals-contract.test.ts,
    ]
---

# Use Squire without an AI provider

Enable the assistant under **Settings → Intelligence → Assistant & AI**. The **Enable AI** switch can remain off. Basic mode uses deterministic language rules, product instructions and fresh OpsKnight database reads. It does not call a language model, run commands or send a page, and it changes an incident only when you confirm a card it prepared.

Open the assistant or press **⌘/Ctrl+J**. These are example questions, not required command syntax:

- **Your work:** “My open incidents”, “Show unassigned incidents”, “Show my team’s unassigned incidents”, “Show my high urgency P1 incidents”. Person assignment and team assignment are separate; unassigned means neither is set.
- **Incident search:** “Find checkout incidents from last week”, “Show resolved incidents today”. Filters can include status, urgency, priority, service/title keywords, ownership and a time window. Quoted names help distinguish services with similar names.
- **Reports:** “How many incidents this week?”, “Which services are noisiest?”, “What is our MTTR this month?”. Reports show the interpreted filters, the reporting period and comparison with the preceding equal-length period. Top services are ranked by matching incident count, not measured alert noise or customer impact.
- **Alerts:** “How many alerts today?”, “Show recent checkout alerts”. Alert counts are stored records linked to readable incidents, not distinct incidents or pages delivered. The time filter is alert creation time; recovery timestamps are not inferred from payloads.
- **Services:** “List services”, “Who owns Checkout?”, “What is the status of Checkout?”, “Service dependencies for Checkout”. Answers can include configured status, the owning team, escalation policy, acknowledgement/resolution targets, visible active incidents and recorded dependencies. Configured status is not a live availability probe.
- **On call:** “Who is on call for Checkout?”, “Who is on call tomorrow?”, “Who is on call in 2 hours?”. A named service uses its policy’s schedule targets. No unrelated schedule is substituted when that service has no schedule target. Future questions report coverage at a particular timestamp, not an entire day’s coverage.
- **Runbooks:** “Find database runbooks”, “List runbooks”. Search covers readable non-archived names, descriptions and tags, and shows whether a published version exists. Reading a runbook is separate from permission to execute it.
- **Changes:** “Recent deployments for Checkout”, “Show changes today”. This reads recorded change events. Timing alone is not a confirmed cause, and basic mode does not query an external deployment system.
- **Follow-up work:** “Show overdue action items”, “My tasks”, “Find checkout postmortems”. Answers use the same incident access rules as the product. Draft postmortem findings can change.
- **An incident in context:** “Summarise this incident”, “Who is assigned to this incident?”, “Show the timeline”, “Similar incidents?”, “What could have caused this?”, “Which runbook fits?”. Recommendations carry their existing freshness notices.
- **Product guidance:** “How do schedule overrides work?”, “How do I resolve an incident?”, “Explain urgency and priority”, “How do I enable AI?”, “What is SCIM?”, “How long is chat history kept?”. These explain workflows, not the current configuration of your installation.

## Understanding, names and clarifications

Basic mode tolerates everyday phrasing. Typos in common words are corrected (“incidnets”, “postmortms”), and service, team and person names are matched to the closest one **you can see**, so “who owns chekout api” answers for Checkout API and says so. When several names fit, Squire lists them and waits for your choice; reply with the name or its number. When a question could mean two things, Squire offers the two readings as buttons instead of guessing.

- **Dates:** “since Monday”, “since 2026-11-01”, “between Monday and Wednesday”, “on 5 Nov”, “last Friday”, “past 24h”, “7d”. Days are whole days in your profile timezone, windows are capped at 90 days, and future dates are refused.
- **Breakdowns:** “incidents by team this week”, “by urgency”, “per day”, “per hour”. Team counts are incident assignment, not service ownership. Reports include mean time to acknowledge and to resolve over a bounded sample of up to 5,000 incidents.
- **Paging:** lists show five at a time; say **show more** (or press the chip) for the next five. “top 10 noisiest services” or “show 20 incidents” changes the page size, up to 20.
- **People and teams:** “incidents assigned to Alice Smith”, “what is assigned to @alice”, “incidents for the payments team”.
- **Page context:** on a service, team or schedule page, “this service”, “who is on call here” and “open incidents” use that page. On an alert page, the alert’s incident is the context.

## Actions you confirm

On an incident page, ask for an action in plain words or with a shortcut and Squire prepares a **confirmation card**. Nothing changes until you press Confirm, and the change runs with your own permissions through the same commands as the incident page.

| Say                                                    | Card                   |
| ------------------------------------------------------ | ---------------------- |
| “acknowledge this” or `/ack`                           | Acknowledge            |
| “resolve this: rolled back release 42” or `/resolve …` | Resolve with that note |
| “add a note: customer impact confirmed” or `/note …`   | Add a timeline note    |
| “assign this to Alice Smith” or `/assign Alice`        | Reassign               |
| “link to incident cm…”                                 | Mark as related        |

If something is missing (the resolution note, or which of several people you mean), Squire asks for it and prepares the card from your reply. A how-to question (“how do I acknowledge an incident?”) gets instructions, never a card. Other shortcuts: `/oncall <service or team>`, `/incidents <filters>` and `/help`.

## Suggested checks and feedback

Incident answers include **suggested checks**: investigation prompts chosen by the incident title. Administrators can add their own in **Settings → Intelligence → Assistant & AI → Suggested checks** (a title pattern and up to six checks); theirs match before the built-in ones. They are prompts only and never run anything.

Each answer has thumbs up and down. A thumbs down asks for a short reason. Only the mode, the question type and the reason are stored, never the question or the answer; administrators see the totals under **Settings → Intelligence → Quality**.

Identical questions asked again within ten seconds are answered from a short per-person cache.

Follow-ups reuse earlier **user questions** as query context and read fresh facts. For example, after “Show high urgency checkout incidents today”, ask “And low urgency yesterday?”. New time, status, urgency and explicit service filters replace the old ones. Earlier assistant text never supplies facts or authorization.

## Reporting limits

Calendar expressions such as today, yesterday, this week and this month use your profile timezone and are labelled in the answer. “Last week” and “past week” mean the past seven days. Rolling windows are supported up to 90 days. Resolution and acknowledgement searches use their recorded event timestamps; ordinary searches use incident creation time.

Listings show five results per page by default (up to 20 when asked), with **show more** for the next page. Dependency reads show at most ten edges; routing reads show at most twenty rules. Broad on-call queries check at most five readable schedules. The assistant labels these bounds and asks for a more specific service when necessary. An answer that touches more than 32 records cites the first 32 and says so.

Incident totals cover the matched authorized cohort. Mean time to resolution and to acknowledge use at most the 5,000 most recent matching records, exclude invalid durations, and state when sampling applies. They measure wall-clock time, not SLA elapsed time with pauses.

An empty result covers only your visible data. It does not prove an item does not exist, that a service is healthy, or that paging succeeded. Sources can change between reads; the assistant asks for a fresh answer when evidence cannot be verified. Saved chats remain private and source access is checked when reopening them, including service, schedule and postmortem citations.
