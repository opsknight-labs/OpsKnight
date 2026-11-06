---
title: Use Squire without an AI provider
description: Ask permission-scoped operational questions and get product guidance in basic mode.
---

# Use Squire without an AI provider

Enable the assistant under **Settings → Intelligence → Assistant & AI**. The **Enable AI** switch can remain off. Basic mode uses fixed question rules, product instructions and fresh OpsKnight database reads. It does not call a language model, run commands, change incidents or send a page.

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

Follow-ups reuse earlier **user questions** as query context and read fresh facts. For example, after “Show high urgency checkout incidents today”, ask “And low urgency yesterday?”. New time, status, urgency and explicit service filters replace the old ones. Earlier assistant text never supplies facts or authorization.

## Reporting limits

Calendar expressions such as today, yesterday, this week and this month use your profile timezone and are labelled in the answer. “Last week” and “past week” mean the past seven days. Rolling windows are supported up to 90 days. Resolution and acknowledgement searches use their recorded event timestamps; ordinary searches use incident creation time.

Listings show at most five results. Dependency reads show at most ten edges; routing reads show at most twenty rules. Broad on-call queries check at most five readable schedules. The assistant labels these bounds and asks for a more specific service when necessary.

Incident totals cover the matched authorized cohort. Mean time to resolution uses at most the 500 most recently resolved matching records, excludes invalid durations, and states when sampling applies. It measures wall-clock time, not SLA elapsed time with pauses.

An empty result covers only your visible data. It does not prove an item does not exist, that a service is healthy, or that paging succeeded. Sources can change between reads; the assistant asks for a fresh answer when evidence cannot be verified. Saved chats remain private and source access is checked when reopening them, including service, schedule and postmortem citations.
