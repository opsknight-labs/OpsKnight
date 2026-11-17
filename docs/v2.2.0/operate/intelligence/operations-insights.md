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

| Area                                | Insight                                                                                               | What it means                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service automation and integrations | **No alerts for N days**                                                                              | The service used to send alerts regularly and has been quiet for much longer than its usual gap. Check that its integrations are still connected. Reported for 30 days, then dropped.                                                                                                         |
| Service automation and integrations | **Alert volume is N times the usual** / **dropped sharply**                                           | The last 24 hours are far above, or far below, the week before.                                                                                                                                                                                                                               |
| Service automation and integrations | **N% of recent alerts have no severity**                                                              | Most recent alerts arrived without a severity, so urgency and routing rules cannot use it.                                                                                                                                                                                                    |
| Service automation and integrations | **A route rule has not matched in N days** / **An enrichment rule did not match any recent incident** | The rule never applied to the incidents the service actually received. Check its conditions or remove it.                                                                                                                                                                                     |
| Service automation and integrations | **A route rule is always decided by an earlier rule**                                                 | Its conditions held, but an earlier route rule always matched first, so it never routes anything.                                                                                                                                                                                             |
| Service automation and integrations | **A context field is unmapped for N% of incidents**                                                   | Integrations send values for the field that are not among its allowed values or aliases, so conditions on it read as unknown.                                                                                                                                                                 |
| Service automation and integrations | **Responders often correct incidents routed by a route rule**                                         | In the last 30 days, a person changed the priority, urgency or assignee of 30% or more of the incidents that rule routed within 15 minutes.                                                                                                                                                   |
| Service automation and integrations | **Incidents automation routes to one policy are never acknowledged**                                  | At least 10 incidents were routed to the same escalation policy and none was acknowledged.                                                                                                                                                                                                    |
| Service automation and integrations | **Suggested rule: set P2 when …**                                                                     | People kept changing incidents with the same severity or source to the same priority. The evidence shows how many incidents and how consistently. **Create draft** opens the automation editor with the rule filled in; nothing is added until you add it, and publishing replays it first.   |
| Escalation policies                 | **Step N was never acknowledged**                                                                     | At least 5 pages reached the step in 30 days and none was acknowledged there.                                                                                                                                                                                                                 |
| Escalation policies                 | **Step 1 times out most nights**                                                                      | Half or more of the night pages (22:00 to 07:00 for the person paged) passed to step 2 unanswered, clearly more than by day.                                                                                                                                                                  |
| Escalation policies                 | **Step N is always skipped**                                                                          | The step paged nobody, with the most common reason (nobody on call, no contact method, inactive user, conditions never match).                                                                                                                                                                |
| Escalation policies                 | **Wait M minutes before step N, not K**                                                               | 75% of acknowledgements came within M minutes, with how many incidents would have reached the next step sooner.                                                                                                                                                                               |
| Escalation policies                 | **One person is on every step**                                                                       | Nobody covers for that person when they are away.                                                                                                                                                                                                                                             |
| Escalation policies                 | **No service uses this policy**                                                                       | Attach it to a service or archive it.                                                                                                                                                                                                                                                         |
| On-call schedules                   | **Nobody is on call for part of N days in the next 14 days**                                          | The final rotation (layers and overrides) leaves a gap. Critical when the gap starts today or tomorrow. Fix it with an override or a layer change.                                                                                                                                            |
| On-call schedules                   | **The same person is primary and backup for N hours**                                                 | The escalation policy's next step after this schedule pages someone who is already on call here, so a missed page reaches the same person twice.                                                                                                                                              |
| On-call schedules                   | **Load is uneven: N responders above 1.5x the rotation's mean**                                       | Over the last 28 days, pages per on-call week differ widely. Needs at least three people and eight pages.                                                                                                                                                                                     |
| On-call (a person)                  | **On-call load is Nx the rotation's mean**                                                            | One person took more than 1.5x the mean pages per on-call week. Visible to that person, their team owners and administrators.                                                                                                                                                                 |
| On-call (a person)                  | **Paged at night on N nights**                                                                        | Night pages (22:00 to 07:00 in the person's own time zone) recurred across at least three weeks of the last four.                                                                                                                                                                             |
| On-call (a person)                  | **Next shift may be busy**                                                                            | The person's shift starts within 24 hours and a service the schedule covers has a risky change in the last day, a burning SLO or a maintenance window ending. The same heads-up appears in their handoff summary.                                                                             |
| Postmortems                         | **Repeat problem, seen N times, has N overdue action items**                                          | The same problem came back on the service at least twice in 90 days while a follow-up from an earlier postmortem is past due. Critical when the problem was seen three or more times and a follow-up is high priority or a month late. **Create draft** opens that postmortem.                |
| Runbooks                            | **Failed N of M runs**                                                                                | Over the last 90 days, at least a quarter of the runbook's finished runs failed or timed out, allowing for how few runs there may be (critical from a half). Needs at least 5 runs.                                                                                                           |
| Runbooks                            | **Not run in the last 90 days** / **Never run since it was published**                                | A published runbook nobody has needed for 90 days. Check its bindings, or archive it.                                                                                                                                                                                                         |
| Runbooks                            | **Step "X" fails in N% of runs**                                                                      | One step failed in more than 30% of at least 5 runs; the most common error code is named.                                                                                                                                                                                                     |
| Runbooks                            | **Step "X" needed a retry in all N runs**                                                             | The step never works on the first attempt (at least 3 runs). Fix what it waits for, or give it a longer timeout.                                                                                                                                                                              |
| Runbooks                            | **Responders add the same note after N of M runs**                                                    | After at least 3 successful runs, and most of them, responders wrote much the same note on the incident within a day: the runbook is probably missing that step.                                                                                                                              |
| Runbooks (on the service)           | **N incidents of one recurring problem were resolved by hand the same way**                           | At least 3 incidents with the same masked title were resolved manually with similar resolution notes and no runbook ran on any of them. **Create draft** opens the service's runbook suggestions, where you can turn the notes into a draft runbook.                                          |
| Notifications (a person)            | **A service pages you but rarely needs you**                                                          | Over the last 30 days a service paged you at least 5 times and you acted on 20% or less, or half or more of its pages were for incidents its source or automation closed within 5 minutes. Opens the service's notification settings, where you can move it to a digest or lower its urgency. |
| Notifications (a person)            | **Night pages you rarely act on**                                                                     | Quiet hours are off and you acted on 20% or less of at least 5 pages between 22:00 and 07:00 your time. Opens your quiet hours.                                                                                                                                                               |
| Notifications (a person)            | **Email / SMS / Voice / Push / WhatsApp is bouncing, invalid, opted out or failing**                  | That channel cannot reach you right now. Opens your notification settings.                                                                                                                                                                                                                    |
| Notifications (a service)           | **Most pages from this service need nobody**                                                          | The same test summed over everyone the service paged, from 20 pages up.                                                                                                                                                                                                                       |

## Escalation policies

With **Escalation policies** on, each policy page gets:

- an **Insights** tab, shown only while the policy has an open insight;
- one quiet line under every step: pages in the last 30 days, the share acknowledged at that step, and the
  median time to acknowledge;
- a count badge on the policies list.

**Apply suggestion** on a timeout insight opens the step editor with the suggested wait filled in. Nothing
changes until you save.

Step history is recorded from the upgrade onward. When escalation insights are switched on, OpsKnight fills
the last 90 days from the escalation timeline in the background, in small batches that resume after a
restart; there is nothing to run. Backfilled
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

## In the postmortem editor

With the **Postmortems** area on, the postmortem editor adds, beside the form:

- **Recurrence**: "Seen N times in 90 days", the last postmortem for an earlier occurrence and the action
  items from earlier occurrences that are still open (overdue ones are marked). Shown only when the problem
  has happened before. The same strip is available for the incident page.
- **Auto-Draft with evidence**: **Auto-Draft** still fills the template, and now also writes in what is
  already known: the Intelligence timeline, causes responders confirmed (marked helpful or correct) and
  linked changes, runbook runs and their outcome, the recurrence and fixes from similar incidents.
  Unconfirmed causes are labelled as correlation only. **Draft with AI** goes through the AI result cache,
  so drafting the same incident twice costs nothing.
- **Suggested action items**: follow-ups from confirmed causes, failed runbooks and known fixes. A
  suggestion that an open action item already covers (in this postmortem or an earlier one) links to that
  item instead of offering a copy. **Add** puts it in the form; nothing is saved until you save.
- **Still missing**: a checklist of a missing root cause, no action items, open action items without an
  owner or due date, and timeline gaps longer than 30 minutes while the incident was open. It disappears
  when the postmortem is complete.

Everything here is deterministic and works without an AI provider. You see only incidents, postmortems,
action items and runbooks you can already open.

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

### In plain words

Where a page lists the insights of one thing (a service, a policy, a schedule), and an AI provider is set up,
the list ends with **Explain in plain words**. Nothing is sent to a model until you expand it. Then all of
that list's open insights are rewritten in one request, a sentence or two each, from the same facts the
evidence shows. The titles and summaries above stay as they are; the rewrite is labelled as written by AI.
Expanding the same unchanged list again within a day costs nothing when **Reuse answers for unchanged facts**
is on. When the daily AI budget is used up, or no provider may receive the data, the list says so and shows
only the original text.

## In the weekly digest

When the weekly Intelligence digest is on, each recipient's email also lists up to five of their open
insights, most severe first, with a link to each and to the full list on **Intelligence**. Recipients see
only insights for things they can open. The list is left out when there are none, or when operations
insights are off.

With **Show small helpers** also on, the digest adds a short reliability brief for each team the recipient
belongs to (up to five): incidents in the last 7 days against the week before, how many insights are open
on the team, its services and their escalation policies, the top three, and a link to the team page. When
AI is on, one cached call per team adds a plain-language sentence or two on the same facts. A quiet team
(no incidents in either week, nothing open) is left out.

## Small helpers

A separate switch, **Settings → Intelligence → Show small helpers** (off by default), adds four helpers
that work from your existing data with no AI provider. None of them creates, saves or publishes anything;
they only fill a form you then review.

| Where                                       | What you get                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create incident**                         | After you type a title of at least eight characters and pause, suggestions appear under it: a service and an urgency when most similar past incidents agree, and a link to an unresolved incident that may already cover the same problem. Selecting a suggestion only fills that field. |
| Status page **Announcements → New**         | **Start from an open incident that affects this page** lists open incidents on the page's components or on services those components depend on. Choosing one fills the title, message, type and affected components; review and publish as usual.                                        |
| Command palette                             | Below the usual matches, **From past incidents and runbooks** shows up to five passages from incidents, postmortems and runbooks that match a question of three words or more, such as "payments timeout after deploy". Requires the knowledge index to be on.                           |
| **Analytics** cards (incidents, MTTA, MTTR) | One line names the services that moved the number most against the previous period of the same length, for example "Most of the rise: Payments +10, Checkout +2". **Why?** shows the numbers behind it and, when an AI provider is set up, a two-sentence explanation.                   |

The analytics line reads the daily rollups, so it covers complete days only and leaves today out. It
counts only services you can open, so two people can see different lines on the same card.

## Who sees what

You see insights only for things you can already open: a responder limited to their teams sees their
teams' services. Insights about one person, such as on-call load or notification noise, are visible to that
person, the owners of their teams and administrators only. A person's noise report follows the same rule and
names a service only if the viewer can open it; insights about a person never store a service name.

## Data and retention

Insights hold derived counts and short facts, never alert payloads. They are sent to an AI provider only
when a person expands **Explain in plain words**, and then only the insights that person can see (an
insight about a person counts as personal data and goes only to providers cleared for it). Resolved and dismissed insights are deleted after the Intelligence finding retention. Daily
counts used by later insights (pages per person and hour, pages per person, service and hour, pages per service,
runbook outcomes, automation rule matches) are
kept for the metrics retention; a deleted person's counts and insights are removed by the next retention
sweep.

## Troubleshooting

| Symptom                                                   | Check                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No **Health** section on a runbook                        | The runbooks area is on and you can open the runbook. With no runs in 90 days the numbers are empty.                                                                                                    |
| No **Needs attention** section                            | The master switch and the area are on, Intelligence is enabled and its worker is running (**Settings → Intelligence → Status**). An empty section is hidden by design.                                  |
| An insight you fixed is still listed                      | Each item is revisited once a day. It resolves at the next visit.                                                                                                                                       |
| No **Load & fairness** tab                                | The **On-call schedules** area is off.                                                                                                                                                                  |
| **Load & fairness** shows zero on-call time for past days | The days before the area was turned on were not recorded. Run `npm run backfill:oncall-coverage`.                                                                                                       |
| No suggestions while creating an incident                 | **Show small helpers** is on, the title is at least eight characters, and similar past incidents exist for services you can open. Suggestions that agree with what you already picked are not repeated. |
| No "why" line on an analytics card                        | The rollups have no data for the comparison period, the number did not change, or the helpers are off.                                                                                                  |
| "These settings changed since you opened the page"        | Someone else saved Intelligence settings. Refresh and save again.                                                                                                                                       |
