---
title: See noise decisions and groups on incidents and incident lists
description: Read storm groups, noise decisions and suggestion history on an incident, ungroup an alert so it pages, post a summary as a note, and filter the incident list by noise decision.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Understand why an alert did not page, undo a wrong grouping, and find grouped, suppressed or in-maintenance incidents.
verification:
  level: test
  verified_at: 2026-11-09
  evidence:
    [
      src/components/incident/intelligence,
      src/lib/intelligence/incident-ux,
      src/lib/intelligence/timeline/service.ts,
      tests/integration/intelligence/incident-ux.test.ts,
      tests/e2e/intelligence-incident-ux.spec.ts,
    ]
---

# See noise decisions and groups on incidents and incident lists

Noise controls (maintenance windows, suppression rules, storm grouping and the others under
**Settings › Intelligence › Noise controls**) decide before paging whether an alert pages, is grouped
under an open incident, or is suppressed. These screens show those decisions where responders work.
Everything here respects incident visibility: you only see incidents, parents and precedents you can
already open.

## Group view on an incident

When an incident is a storm or correlation parent, or is grouped under one, a **Grouped under this
incident** (parent) or **Part of a group** (child) card appears above the Intelligence panel.

- A mini timeline shows each grouped incident and alert as a dot relative to when the parent opened.
  The list beneath it gives the same items with their offset, so the timeline is not needed to read it.
- On a child, the card links to the parent. If you cannot open the parent, the card only says the
  incident is grouped.
- **Ungroup and page** (administrators, the same permission as the noise settings page) releases a
  grouped alert: after you confirm, the alert is re-ingested as its own incident and pages through
  its escalation policy. The card links to the new incident. The grouping is recorded as a wrong
  decision, which counts against it in the noise-control reports.
- **Ungroup** on a child incident (anyone who may give intelligence feedback) removes it from the
  group. The incident keeps its own escalation; the grouping is not proposed again.

## Intelligence events in the Timeline tab

The **Timeline** tab in the incident's Intelligence panel now also shows:

- **Noise decisions** on this incident's alerts: suppressed by a rule, in a maintenance window,
  deduplicated, grouped into a parent, held during a possible storm. **Why?** expands the reasons.
  Shadow-mode decisions are labelled "Shadow" and changed nothing.
- **Reverse and page** or **Mark wrong** (administrators) on a decision that has not been reversed.
  Reverse and page re-ingests the alert so it pages; Mark wrong only records the mistake.
- **Grouping** into a parent, and **suggestions** that people accepted, rejected or undid, with who
  did it. An incident you cannot open is named "an incident you cannot view".
- **Triage suggestions** accepted or dismissed.

## Post a summary as a note

After **Summarise this incident** produces a summary, **Post summary as note** adds it to the
incident's notes through the normal note command. It needs the same permission as writing a note
(responders and administrators). The note says the summary was AI-generated and should be verified.
AI summaries appear only when an administrator has configured an AI provider; administrators see a
link to **Settings › Intelligence › AI** when it is off.

## Badges and the noise filter on the incident list

Rows on **Incidents** can show:

| Badge                        | Meaning                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| **Grouped → #ABCDE**         | Grouped under parent #ABCDE (links to it; shows just "Grouped" if you cannot open it). |
| **N grouped**                | This incident is a parent with N grouped incidents or alerts.                          |
| **Suppressed by <rule>**     | An applied, unreversed suppression, flapping or orchestration decision.                |
| **In maintenance: <window>** | An applied, unreversed maintenance-window decision.                                    |
| **Similar to #ABCDE**        | A similar-incident suggestion from the last 72 hours with at least 80% confidence.     |

The **Noise decisions** filter limits the list to **Grouped**, **Suppressed by a rule** or **In
maintenance** incidents. While it is set, new incidents are not inserted live; refresh to update.

Badges for a page of results come from one bounded query, so they do not slow the list. If the noise
layer is not enabled, no badges appear and the filter returns nothing.

## Wallboard noise tile

The wallboard (`/wallboard`) shows a **Noise reduction** tile with the last 24 hours: pages avoided
(or, when every policy is in shadow mode, what would be avoided), alerts per incident, grouped alerts
and how many were ungrouped, and missing heartbeats. It is shown to roles that may read intelligence.
When noise controls are off the tile says so, and administrators get a link to turn them on. The tile
is read when the wallboard loads; reload the page to refresh it.
