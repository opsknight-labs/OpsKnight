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

| Area                                | Insight                                                                              | What it means                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service automation and integrations | **No alerts for N days**                                                             | The service used to send alerts regularly and has been quiet for much longer than its usual gap. Check that its integrations are still connected. Reported for 30 days, then dropped.                                                                                                         |
| Service automation and integrations | **Alert volume is N times the usual** / **dropped sharply**                          | The last 24 hours are far above, or far below, the week before.                                                                                                                                                                                                                               |
| Service automation and integrations | **N% of recent alerts have no severity**                                             | Most recent alerts arrived without a severity, so urgency and routing rules cannot use it.                                                                                                                                                                                                    |
| Notifications (a person)            | **A service pages you but rarely needs you**                                         | Over the last 30 days a service paged you at least 5 times and you acted on 20% or less, or half or more of its pages were for incidents its source or automation closed within 5 minutes. Opens the service's notification settings, where you can move it to a digest or lower its urgency. |
| Notifications (a person)            | **Night pages you rarely act on**                                                    | Quiet hours are off and you acted on 20% or less of at least 5 pages between 22:00 and 07:00 your time. Opens your quiet hours.                                                                                                                                                               |
| Notifications (a person)            | **Email / SMS / Voice / Push / WhatsApp is bouncing, invalid, opted out or failing** | That channel cannot reach you right now. Opens your notification settings.                                                                                                                                                                                                                    |
| Notifications (a service)           | **Most pages from this service need nobody**                                         | The same test summed over everyone the service paged, from 20 pages up.                                                                                                                                                                                                                       |

Insights for the other areas arrive with later updates; their switches are already there so you can decide
in advance.

## Your notification noise

With the **Notifications** area on, **Settings > Profile > Notifications** (and **More** on mobile) has a
**Noise** section with:

- **Bundle low-urgency pages**, off by default. When on, the first low-urgency page in a five-minute window
  arrives at once and the others in that window arrive together as one. High-urgency pages and account
  messages (sign-in, verification) are never bundled.
- **Last 30 days**: pages received, the share you acted on, and how many were for incidents that closed by
  themselves within 5 minutes; a bar per local hour; and the five busiest services.
- **Suggestions**: the insights above for you, each opening the setting it is about. Nothing changes until
  you save there.

A page is one incident that notified you on a day, however many channels it used. You "acted on" it when
you acknowledged through that page (the voice key press or the push notification's action) or when you
acknowledged the incident as its assignee. Counts are daily and cover complete days, so today's pages show
up tomorrow.

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
teams' services. Insights about one person, such as on-call load or notification noise, are visible to that
person, the owners of their teams and administrators only. A person's noise report follows the same rule and
names a service only if the viewer can open it; insights about a person never store a service name.

## Data and retention

Insights hold derived counts and short facts, never alert payloads, and are not sent to any external
provider. Resolved and dismissed insights are deleted after the Intelligence finding retention. Daily
counts used by insights (pages per person and hour, pages per person, service and hour, pages per service,
runbook outcomes, automation rule matches) are
kept for the metrics retention; a deleted person's counts and insights are removed by the next retention
sweep.

## Troubleshooting

| Symptom                                            | Check                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No **Needs attention** section                     | The master switch and the area are on, Intelligence is enabled and its worker is running (**Settings → Intelligence → Status**). An empty section is hidden by design. |
| An insight you fixed is still listed               | Each item is revisited once a day. It resolves at the next visit.                                                                                                      |
| "These settings changed since you opened the page" | Someone else saved Intelligence settings. Refresh and save again.                                                                                                      |
