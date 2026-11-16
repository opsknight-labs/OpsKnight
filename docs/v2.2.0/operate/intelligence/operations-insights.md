---
title: Operations insights
description: Turn on daily, deterministic suggestions about services, escalation policies, schedules, runbooks and notifications, and review them in one inbox.
type: how-to
product_area: intelligence
audience: [operator, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Turn operations insights on for the areas you want, understand what is computed and when, and act on or dismiss what they find.
verification:
  level: test
  verified_at: 2026-11-11
  evidence:
    [
      src/lib/intelligence/ops-insights,
      src/lib/metric-rollup.ts,
      src/components/intelligence/insights,
      tests/lib/intelligence/ops-insights.test.ts,
      tests/integration/intelligence/ops-insights.test.ts,
      tests/integration/intelligence/ops-rollups.test.ts,
      tests/components/intelligence/ops-insights-ui.test.tsx,
    ]
---

# Operations insights

Operations insights are things OpsKnight notices about how your setup behaves: a service whose integration
went silent, for example. They are computed in the background once a day, need no AI provider, and only
suggest. Every change is made by a person in the usual editor.

They are **off after upgrade**. Turning them on adds no work to alert ingestion, escalation or notification
delivery.

## Turn them on

You need permission to manage Intelligence.

1. Open **Settings → Intelligence**. Intelligence itself must be enabled.
2. In **Operations insights**, tick **Compute operations insights**.
3. Tick the areas you want: service automation and integrations, escalation policies, on-call schedules,
   postmortems, runbooks, notifications.
4. Select **Save**.

Within about 15 minutes the background worker starts working through your services, policies, schedules and
runbooks, a few hundred at a time, and then revisits each one daily. A very large estate takes up to a day
for its first pass.

To turn an area off, untick it and save. Its insights disappear from every page straight away and are
marked resolved the next time each item is revisited. Unticking **Compute operations insights** hides
everything and stops the daily work.

## What is available today

| Area | Insight | What it means |
| --- | --- | --- |
| Service automation and integrations | **No alerts for N days** | The service used to send alerts regularly and has been quiet for much longer than its usual gap. Check that its integrations are still connected. Reported for 30 days, then dropped. |
| Service automation and integrations | **Alert volume is N times the usual** / **dropped sharply** | The last 24 hours are far above, or far below, the week before. |
| Service automation and integrations | **N% of recent alerts have no severity** | Most recent alerts arrived without a severity, so urgency and routing rules cannot use it. |
| Service automation and integrations | **A route rule has not matched in N days** / **An enrichment rule did not match any recent incident** | The rule never applied to the incidents the service actually received. Check its conditions or remove it. |
| Service automation and integrations | **A route rule is always decided by an earlier rule** | Its conditions held, but an earlier route rule always matched first, so it never routes anything. |
| Service automation and integrations | **A context field is unmapped for N% of incidents** | Integrations send values for the field that are not among its allowed values or aliases, so conditions on it read as unknown. |
| Service automation and integrations | **Responders often correct incidents routed by a route rule** | In the last 30 days, a person changed the priority, urgency or assignee of 30% or more of the incidents that rule routed within 15 minutes. |
| Service automation and integrations | **Incidents automation routes to one policy are never acknowledged** | At least 10 incidents were routed to the same escalation policy and none was acknowledged. |
| Service automation and integrations | **Suggested rule: set P2 when …** | People kept changing incidents with the same severity or source to the same priority. The evidence shows how many incidents and how consistently. **Create draft** opens the automation editor with the rule filled in; nothing is added until you add it, and publishing replays it first. |

Insights for the other areas arrive with later updates; their switches are already there so you can decide
in advance.

## Service automation

Automation insights appear in the service's **Automation** tab under **Configuration health**, with rule
names filled in for people who may view automation. Elsewhere (the **Needs attention** inbox) they show
counts only.

Before you publish an automation draft, the review dialog offers **Replay against last 7 days**: it runs the
draft over the service's stored alerts (up to 20,000, 7 to 30 days) and shows how many incidents would have
been routed or prioritised differently, which rules never matched or were always decided by an earlier
rule, unmapped fields and how long evaluation took. The **Test** tab offers the same replay. A replay reads
history only; it never changes an incident. The same replay is available over the REST API at
`POST /api/v2/services/{id}/automation/replay` (then `GET` with the returned `runId`).

Squire can explain why an incident was routed the way it was and what a rule does. Asked to write a rule, it
offers a link to the editor with the rule filled in; it never saves or publishes automation.

## Review insights

Open **Intelligence**. When there is something to review, a **Needs attention** section lists open
insights, most severe first. When there is nothing, the section is not shown.

For each insight you can:

- **Evidence**: see the numbers behind it and the period they cover.
- **Create draft**: open the page where you would fix it. Nothing is saved until you save it there.
- **Ask Squire about this**: hand the insight to the assistant as a question (shown when Squire is on).
- **Accept**: you intend to act on it. It stays recorded as accepted until the condition goes away.
- **Dismiss**: it is not useful. It stays dismissed even though it is still detected; **Reopen** brings it
  back.

When the condition goes away, the insight resolves by itself. If it returns later, it opens again.

Accepting, dismissing and reopening are recorded in the audit log.

### In plain words

Where a page lists the insights of one thing (a service, a policy, a schedule), and an AI provider is set up,
the list ends with **Explain in plain words**. Nothing is sent to a model until you expand it. Then all of
that list's open insights are rewritten in one request, a sentence or two each, from the same facts the
evidence shows. The titles and summaries above stay as they are; the rewrite is labelled as written by AI.
Expanding the same unchanged list again within a day costs nothing when **Reuse answers for unchanged facts**
is on. When the daily AI budget is used up, or no provider may receive the data, the list says so and shows
only the original text.

## Who sees what

You see insights only for things you can already open: a responder limited to their teams sees their
teams' services. Insights about one person, such as on-call load, are visible to that person, the owners of
their teams and administrators only.

## Data and retention

Insights hold derived counts and short facts, never alert payloads. They are sent to an AI provider only
when a person expands **Explain in plain words**, and then only the insights that person can see (an
insight about a person counts as personal data and goes only to providers cleared for it). Resolved and dismissed insights are deleted after the Intelligence finding retention. Daily
counts used by later insights (pages per person and hour, runbook outcomes, automation rule matches) are
kept for the metrics retention; a deleted person's counts and insights are removed by the next retention
sweep.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No **Needs attention** section | The master switch and the area are on, Intelligence is enabled and its worker is running (**Settings → Intelligence → Status**). An empty section is hidden by design. |
| An insight you fixed is still listed | Each item is revisited once a day. It resolves at the next visit. |
| "These settings changed since you opened the page" | Someone else saved Intelligence settings. Refresh and save again. |
