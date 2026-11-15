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

| Area                                | Insight                                                     | What it means                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service automation and integrations | **No alerts for N days**                                    | The service used to send alerts regularly and has been quiet for much longer than its usual gap. Check that its integrations are still connected. Reported for 30 days, then dropped. |
| Service automation and integrations | **Alert volume is N times the usual** / **dropped sharply** | The last 24 hours are far above, or far below, the week before.                                                                                                                       |
| Service automation and integrations | **N% of recent alerts have no severity**                    | Most recent alerts arrived without a severity, so urgency and routing rules cannot use it.                                                                                            |

Insights for the other areas arrive with later updates; their switches are already there so you can decide
in advance.

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

## In the weekly digest

When the weekly Intelligence digest is on, each recipient's email also lists up to five of their open
insights, most severe first, with a link to each and to the full list on **Intelligence**. Recipients see
only insights for things they can open. The list is left out when there are none, or when operations
insights are off.

## Small helpers

A separate switch, **Settings → Intelligence → Show small helpers** (off by default), adds four helpers
that work from your existing data with no AI provider. None of them creates, saves or publishes anything;
they only fill a form you then review.

| Where                                       | What you get                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create incident**                         | After you type a title of at least eight characters and pause, suggestions appear under it: a service and an urgency when most similar past incidents agree, and a link to an unresolved incident that may already cover the same problem. Selecting a suggestion only fills that field. |
| Status page **Announcements → New**         | **Draft from an incident** lists open incidents on the page's components or on services those components depend on. Choosing one fills the title, message, type and affected components; review and publish as usual.                                                                    |
| Command palette                             | Below the usual matches, **From incidents, postmortems and runbooks** shows passages from the knowledge index that match a question such as "payments timeout after deploy". Requires the knowledge index to be on.                                                                      |
| **Analytics** cards (incidents, MTTA, MTTR) | One line names the services that moved the number most against the previous period of the same length, for example "Most of the rise: Payments +10, Checkout +2". **Why?** shows the numbers behind it and, when an AI provider is set up, a two-sentence explanation.                   |

The analytics line reads the daily rollups, so it covers complete days only and leaves today out. It
counts only services you can open, so two people can see different lines on the same card.

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

| Symptom                                            | Check                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No **Needs attention** section                     | The master switch and the area are on, Intelligence is enabled and its worker is running (**Settings → Intelligence → Status**). An empty section is hidden by design.                                  |
| An insight you fixed is still listed               | Each item is revisited once a day. It resolves at the next visit.                                                                                                                                       |
| No suggestions while creating an incident          | **Show small helpers** is on, the title is at least eight characters, and similar past incidents exist for services you can open. Suggestions that agree with what you already picked are not repeated. |
| No "why" line on an analytics card                 | The rollups have no data for the comparison period, the number did not change, or the helpers are off.                                                                                                  |
| "These settings changed since you opened the page" | Someone else saved Intelligence settings. Refresh and save again.                                                                                                                                       |
