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
| Escalation policies | **Step N was never acknowledged** | At least 5 pages reached the step in 30 days and none was acknowledged there. |
| Escalation policies | **Step 1 times out most nights** | Half or more of the night pages (22:00 to 07:00 for the person paged) passed to step 2 unanswered, clearly more than by day. |
| Escalation policies | **Step N is always skipped** | The step paged nobody, with the most common reason (nobody on call, no contact method, inactive user, conditions never match). |
| Escalation policies | **Wait M minutes before step N, not K** | 75% of acknowledgements came within M minutes, with how many incidents would have reached the next step sooner. |
| Escalation policies | **One person is on every step** | Nobody covers for that person when they are away. |
| Escalation policies | **No service uses this policy** | Attach it to a service or archive it. |
| On-call schedules | **Nobody is on call for part of N days in the next 14 days** | The final rotation (layers and overrides) leaves a gap. Critical when the gap starts today or tomorrow. Fix it with an override or a layer change. |
| On-call schedules | **The same person is primary and backup for N hours** | The escalation policy's next step after this schedule pages someone who is already on call here, so a missed page reaches the same person twice. |
| On-call schedules | **Load is uneven: N responders above 1.5x the rotation's mean** | Over the last 28 days, pages per on-call week differ widely. Needs at least three people and eight pages. |
| On-call (a person) | **On-call load is Nx the rotation's mean** | One person took more than 1.5x the mean pages per on-call week. Visible to that person, their team owners and administrators. |
| On-call (a person) | **Paged at night on N nights** | Night pages (22:00 to 07:00 in the person's own time zone) recurred across at least three weeks of the last four. |
| On-call (a person) | **Next shift may be busy** | The person's shift starts within 24 hours and a service the schedule covers has a risky change in the last day, a burning SLO or a maintenance window ending. The same heads-up appears in their handoff summary. |

Insights for on-call schedules, postmortems, runbooks and notifications arrive with later updates; their
switches are already there so you can decide in advance.

### Escalation policies

With **Escalation policies** on, each policy page gets:

- an **Insights** tab, shown only while the policy has an open insight;
- one quiet line under every step: pages in the last 30 days, the share acknowledged at that step, and the
  median time to acknowledge;
- a count badge on the policies list.

**Apply suggestion** on a timeout insight opens the step editor with the suggested wait filled in. Nothing
changes until you save.

Step history is recorded from the upgrade onward. To fill the last 90 days from the escalation timeline, an
administrator can run `npm run backfill:escalation-attempts` once (safe to stop and re-run). Backfilled
history is approximate: it assumes the service's current policy and does not know who was paged, so it
never feeds the night-time insight.

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

## On-call load and fairness

With the **On-call schedules** area on:

- Each schedule page has a **Load & fairness** tab: the schedule's on-call insights, the rotation's pages,
  mean pages per on-call week and fairness index (1.00 means every on-call week carried the same load), and
  one row per person with pages, night pages, weekend pages, interrupted hours, longest quiet gap, time on
  call, load against the rotation's mean and a strip of pages per day. All numbers cover the last 28 finished
  days.
- **Schedules** and the mobile **Schedules** page show a **My on-call load** card with your own numbers when
  you were on call or paged in that period.
- Schedules with open insights carry a badge in the schedules list.

You see a person's row only for yourself, for members of teams you own, or as an administrator. Rotation
totals are hidden when the rotation is so small that they would reveal someone else's numbers.

OpsKnight records who was effectively on call each day (after overrides) once the day is over, so the
history stays right after layers are edited or deleted. After turning the area on, an administrator can fill
the last 30 days at once with `npm run backfill:oncall-coverage`; it is safe to run again and resumes with
`--cursor <scheduleId>`.

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
| No **Load & fairness** tab | The **On-call schedules** area is off. |
| **Load & fairness** shows zero on-call time for past days | The days before the area was turned on were not recorded. Run `npm run backfill:oncall-coverage`. |
| "These settings changed since you opened the page" | Someone else saved Intelligence settings. Refresh and save again. |
