---
title: Intelligence on services, teams and dashboards
description: Find dependencies, SLO burn, alert quality, change risk and noise controls on the service page, and the AIOps numbers on the team page, the home dashboard and the wallboard.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Open a service's Intelligence tab, review a suggested dependency, and read the intelligence badges and tiles on the service list, team page, home dashboard and wallboard.
verification:
  level: test
  verified_at: 2026-11-10
  evidence:
    [
      'src/app/(app)/services/[id]/intelligence',
      src/components/service/intelligence,
      src/lib/intelligence/surfaces,
      tests/integration/intelligence/placement-surfaces.test.ts,
      tests/components/IntelligencePlacementSurfaces.test.tsx,
      tests/e2e/service-surfaces.intelligence-ui.spec.ts,
      tests/e2e/dashboard-live.spec.ts,
    ]
---

# Intelligence on services, teams and dashboards

Intelligence shows up where you already look at a service or a team. Every item below is hidden when it
has nothing to say, so a quiet service or team looks exactly as it did before.

## Who sees what

| Surface                                 | Who sees it                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Service **Intelligence** tab            | Administrators, responders and auditors                                 |
| Approve or reject a suggested link      | Administrators                                                          |
| Badges on the service list              | Anyone who can see suggestions, for the services they can open          |
| Team tiles                              | Administrators, responders and auditors                                 |
| **AIOps pulse** on the home dashboard   | Administrators, responders and auditors; quarantined work is admin only |
| **Largest open group** on the wallboard | Administrators, responders and auditors                                 |

A responder or auditor does not get the Intelligence tab on a service where both Intelligence and noise
controls are off. An administrator still gets it, with links to turn them on.

## The service Intelligence tab

Open a service and choose **Intelligence**, or go to `/services/<id>/intelligence`. The tab loads only
when you open it. Each section loads on its own: if one fails it shows a short error and the others still
appear. Sections without data are left out; if none has data the tab says "Nothing to report yet".

- **SLO burn**: for each availability or uptime objective, how fast the error budget was spent over the
  last hour and the last six hours, against the paging limits (14.4× and 6×). **Burning fast** means a
  paging rate, **Burning** means faster than planned, **Within budget** means neither. Downtime is the
  time incidents were open on the service. The section is absent when the service has no such objective.
- **Dependencies**: the service in the middle, what it depends on to the left and what depends on it to
  the right. A service with open incidents shows how many. The list under the diagram has the same
  links and is the only form on a phone.
  - **Suggested dependencies** were observed from incidents that keep happening together. They are drawn
    dashed and labelled **Suggested**, and they affect nothing until approved. An administrator chooses
    **Approve** (the link becomes a real dependency, used for grouping and impact) or **Reject** (it is
    not suggested again). Both are written to the audit log.
  - Only the most recent 24 links of each kind are shown. Administrators can open the full list from
    **See all dependencies**.
- **Alert quality**: the service's noise score over the last 30 days, with the share of incidents
  resolved within five minutes, never acknowledged, or opened as suppressed by the flapping detector. It
  appears once the service has at least five incidents in that period. For a flagged or flapping
  service, administrators get the same fixes as on the AIOps overview: **Create suppression rule**,
  **Lower severity**, and **Open Jira issue** when Jira is connected.
- **Recent changes**: the latest eight changes in the last 14 days, each linking to the change, with its
  risk band (**High**, **Medium** or **Low** risk and the score). Risk ranks changes; it is not a verdict.
- **Noise controls**: the mode that applies to this service (**On**, **Shadow** or **Off**, and whether
  it is set for the service or inherited), pages avoided and alerts against incidents over the last seven
  days, maintenance windows active right now for the service, its team or all services, and heartbeat
  monitors that are missing. Label-based maintenance windows match individual alerts and are not listed.
- **Recurring problems**: incident shapes that came back at least three times on two or more days in
  the last 30 days, each linking to the latest occurrence, with a note when no runbook is attached.
- **Grouping mode**: the Intelligence mode for the service and whether automatic grouping is certified
  for the policy it runs, with the reason when it is not.
- **Learned facts**: how many facts people confirmed about the service, with a link to its Squire memory
  page.

## Badges on the service list

A service row can carry up to three badges next to its status:

- **In maintenance**: a maintenance window for the service, its team or all services is active now.
  Hover for the window's name.
- **SLO burning** or **SLO burning fast**: the availability error budget is being spent faster than
  planned, or at a paging rate.
- **Noise controls on** or **Noise controls: shadow**: the mode that applies to the service.

A service with none of these shows no badge.

## Team tiles

A team's overview shows up to two tiles:

- **AI usage**: what the team spent on AI today (UTC) and over the last seven days, in dollars and
  tokens. When the team has a daily budget, the tile shows how much of it is used and says when it is
  close to (80%) or at the limit. Administrators get a link to **Spend and budgets**.
- **Noise load**: alerts received against incidents created for the team's services over the last seven
  days, the alerts-per-incident ratio, and pages avoided by noise controls (or what shadow mode would
  have avoided).

A tile is left out when there is nothing to report: no AI usage and no budget, or no alerts and no
incidents.

## AIOps pulse on the home dashboard

The **Ops Pulse** panel ends with an **AIOps pulse** row when at least one of these is above zero:

- **Pages avoided** in the last 24 hours by noise controls in **On** mode (reversed decisions excluded).
- **Open groups**: open or acknowledged incidents that have other incidents grouped under them.
- **Triage to review**: triage suggestions (urgency, owner, duplicate) from the last seven days on open
  incidents that nobody has accepted or dismissed yet.
- **Quarantined work** (administrators only): intelligence work that failed repeatedly and waits for an
  operator.

Zero values are not listed, and the row disappears when all are zero. Select it to open the AIOps
overview. The numbers are read when the page loads; reload to refresh them.

## Largest open group on the wallboard

Next to the **Noise reduction** tile, the wallboard names the open incident with the most incidents
grouped under it, and how many. The title links to that incident. The tile is absent when no group is
open. Like the noise tile, it is read when the wallboard loads.

## Related

- [Read the AIOps overview](./aiops-overview.md)
- [Intelligence on incidents and lists](./incidents-and-lists.md)
- [Noise controls](../../operate/intelligence/noise-controls.md)
- [AI cost and budgets](../../operate/intelligence/ai-cost.md)
