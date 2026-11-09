---
title: Build noise controls and test them against the last week
description: Schedule maintenance windows, write suppression and orchestration rules, add heartbeat monitors, and replay each against the last 7 days before saving.
type: how-to
product_area: intelligence
audience: [administrator, responder]
reader:
  status: SOURCE_VERIFIED
  task: Create and preview maintenance windows, suppression rules, orchestration rules and heartbeat monitors; read intelligence on a phone.
verification:
  level: test
  verified_at: 2026-11-09
  evidence:
    [
      src/components/settings/noise-controls,
      src/lib/intelligence/noise-controls/preview.ts,
      src/lib/intelligence/noise-controls/builders.ts,
      src/components/incident/mobile/MobileIncidentIntelligence.tsx,
      tests/components/intelligence/noise-control-builders.test.tsx,
      tests/integration/intelligence/noise-builder-previews.test.ts,
      tests/e2e/noise-builders.intelligence-ui.spec.ts,
    ]
---

# Build noise controls and test them against the last week

Open **Settings › Intelligence › Noise controls**. Anyone with intelligence read access sees the
controls, the agenda and the recorded decisions; only intelligence managers can create, change or
preview them. Every builder has a **Test against the last 7 days** button that replays recent incidents
with only that control switched on and tells you how many would not have paged. A preview never saves
anything, and the saved controls only act once the policy at the top of the page is in SHADOW or ON.

## Maintenance windows

**Schedule maintenance** asks for a name, what it applies to (one service, a team's services, alerts with
a label, or everything), the effect (suppress, or page at a lower urgency) and when it runs. Pick a start
and a two-hour end is filled in; change it if you need to. A window lasts at most seven days.

**Repeats** offers every day, every week on the start day, every weekday, every weekend, every month on
the start date, or a custom RRULE (`FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`).
Repeats are evaluated in UTC. The next five occurrences are listed as you type, and an invalid rule is
explained next to the field.

**Next 14 days** is an agenda of every enabled window, with each occurrence of a repeating window listed
on its day. A window in progress shows **In progress** and an **End now** button: alerts page normally
from that moment and the window's history is kept.

**Edit** opens the window in the builder. Saving creates the updated window and disables the original,
so what the old version suppressed stays explained in the decision history.

If a window starts in the future, its preview replays it at the same weekday and time one or more weeks
earlier, and says so.

## Suppression rules

Add one or more conditions; all of them must match. Each condition picks a field (severity, source,
summary, resource, a label, the content fingerprint or the dedup key), an operator (equals, contains,
starts with, matches regex, exists) and a value. Matching ignores case. Regular expressions with
back-references or nested quantifiers are refused.

While you type, the builder counts how many of the last week's alerts the conditions match (the most
recent 2,000 alerts) and lists a few of them. Pick the **Owner** (you by default) and when the rule
**Expires** (1, 7, 30 or 90 days, never, or a date). Rules suggested from alert quality still appear
under the builder with **Add as rule**.

## Orchestration rules

Orchestration rules are part of the policy and are saved with **Save policy**. They run top to bottom:
the first rule that drops or suppresses an alert wins, and other actions (set urgency, set severity, set
a label, route to another service, attach a runbook, add a note) accumulate.

Reorder with the arrow buttons, by dragging the handle, or by focusing the handle and pressing the up or
down arrow key; the new position is announced. **Test rules against the last 7 days** shows, on each
rule, how many incidents it matched and how many it would have dropped or suppressed. A rule with a
missing name, condition value or action value is flagged where it is wrong.

## Heartbeat monitors

Create a monitor for a scheduled job: its service, how often it should ping, a grace period and the
urgency of the incident raised when it goes missing. The ping URL, the token and an example `curl`
command are shown **once**, each with a **Copy** button; only a hash of the token is stored. Each
monitor shows its status (waiting for first ping, healthy, late, missing, paused), its last ping, when the
next ping is due, and the last incident it raised.

## Intelligence on your phone

On the mobile incident page, the **Intelligence** card shows triage suggestions you can apply or
dismiss, up to three similar past incidents, possible causes and runbooks that have worked on this
service. Each part loads on its own and is left out when there is nothing to show. **Full analysis**
opens the desktop incident page for related incidents, the timeline and the summary. You only see
incidents, services and runbooks you can already open.

If intelligence is off for the service, intelligence managers see a note with a link to the settings;
nobody else sees anything.
