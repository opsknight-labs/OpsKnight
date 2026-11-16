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
| Runbooks | **Failed N of M runs** | Over the last 90 days, at least a quarter of the runbook's finished runs failed or timed out, allowing for how few runs there may be (critical from a half). Needs at least 5 runs. |
| Runbooks | **Not run in the last 90 days** / **Never run since it was published** | A published runbook nobody has needed for 90 days. Check its bindings, or archive it. |
| Runbooks | **Step "X" fails in N% of runs** | One step failed in more than 30% of at least 5 runs; the most common error code is named. |
| Runbooks | **Step "X" needed a retry in all N runs** | The step never works on the first attempt (at least 3 runs). Fix what it waits for, or give it a longer timeout. |
| Runbooks | **Responders add the same note after N of M runs** | After at least 3 successful runs, and most of them, responders wrote much the same note on the incident within a day: the runbook is probably missing that step. |
| Runbooks (on the service) | **N incidents of one recurring problem were resolved by hand the same way** | At least 3 incidents with the same masked title were resolved manually with similar resolution notes and no runbook ran on any of them. **Create draft** opens the service's runbook suggestions, where you can turn the notes into a draft runbook. |

Insights for the other areas arrive with later updates; their switches are already there so you can decide
in advance.

## Runbook health

With the runbooks area on, each runbook's page shows a **Health** section, and the runbooks list shows a
badge on runbooks with open insights. Health shows, for the last 90 days:

- **Success rate** and the rate it is at least (the 95% Wilson lower bound), so a runbook that succeeded
  once out of once does not look perfect.
- **Fixed the incident**: runs that succeeded and whose incident resolved within the fix window after the
  run finished (120 minutes by default). Change it under **Settings → Intelligence → Operations insights →
  Runbook fix window**, from 5 to 1440 minutes; the numbers use the new window straight away.
- **Median duration** (within about 10%), the **most failing step** with its top error code, the **last
  run** and the **last edit**.
- The runbook's open insights, including any suggested missing step. The suggested step's wording comes
  from the notes, and you see it only if you can open the incidents those notes were written on.

The numbers come from daily counts that are computed a day late, so yesterday's runs appear the day after.

### Write a runbook from hand-written fixes

When a service's responders keep resolving one recurring problem by hand the same way, the service's
**Runbooks** tab lists it under **Suggested runbooks** with the resolution notes you can read and the steps
found in them. **Open a draft in the editor** saves an unpublished, unbound runbook of manual steps and opens it in the
editor; nothing runs or publishes until you do it there. You need permission to manage runbooks.

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

## Who sees what

You see insights only for things you can already open: a responder limited to their teams sees their
teams' services. Insights about one person, such as on-call load, are visible to that person, the owners of
their teams and administrators only.

## Data and retention

Insights hold derived counts and short facts, never alert payloads, and are not sent to any external
provider. Resolved and dismissed insights are deleted after the Intelligence finding retention. Daily
counts used by later insights (pages per person and hour, runbook outcomes, automation rule matches) are
kept for the metrics retention; a deleted person's counts and insights are removed by the next retention
sweep.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No **Health** section on a runbook | The runbooks area is on and you can open the runbook. With no runs in 90 days the numbers are empty. |
| No **Needs attention** section | The master switch and the area are on, Intelligence is enabled and its worker is running (**Settings → Intelligence → Status**). An empty section is hidden by design. |
| An insight you fixed is still listed | Each item is revisited once a day. It resolves at the next visit. |
| "These settings changed since you opened the page" | Someone else saved Intelligence settings. Refresh and save again. |
