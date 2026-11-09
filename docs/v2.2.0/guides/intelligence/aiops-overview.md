---
title: Read the AIOps overview
description: See what Intelligence and the noise controls did for your incidents, and fix noisy services from one page.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Read noise, speed, alert quality, change and response metrics for the incidents you can see, and open the fix for a noisy service.
verification:
  level: test
  verified_at: 2026-11-09
  evidence:
    [
      src/app/(app)/intelligence,
      src/lib/intelligence/overview,
      tests/integration/intelligence/overview.test.ts,
      tests/components/intelligence-overview.test.tsx,
      tests/e2e/intelligence-overview.spec.ts,
    ]
---

# Read the AIOps overview

Open **AIOps Overview** in the **Analytics** section of the main navigation, or go to `/intelligence`.
Administrators, responders and auditors can open it. Pick a window at the top: **24h**, **7d** (the
default) or **30d**. The window is part of the address, so you can share a link to the same view.

Everything on the page covers only the services and incidents you can already open. If your access is
limited to your teams, the page says so under the title.

The page only reads data. Each section loads on its own: if one cannot load, it shows a short error and
the others still appear. Paging and escalation never depend on this page.

## Noise

- **Alerts received** and **incidents created** in the window, and **Compression**: alerts per incident.
  Higher means more alerts were folded into fewer incidents.
- **Pages avoided**: alerts that noise controls actually held back (suppressed, dropped, appended to an open
  incident or grouped under a parent). Only controls in **On** mode count here.
- **Would have avoided**: what controls in **Shadow** mode would have held back. Shadow mode never holds
  anything back, so these are never counted as avoided pages.
- **False-group rate**: the share of groupings that someone undid with **Ungroup**.
- **Suppressed by rule or maintenance window**: the rules and windows that held back the most alerts,
  largest first, with the count beside each.

If no noise control is on, the section says so. Administrators also get a link to
**Settings > Intelligence > Noise controls**, where every control starts in shadow mode.

## Speed

- **First insight, median** and **90th percentile**: time from an incident opening to its first suggestion
  (similar incident, cause, runbook or triage chip), with how many incidents got one.
- **Related suggestions accepted**: of the related-incident suggestions responders confirmed or rejected,
  the share confirmed.
- **Findings rated helpful**: thumbs-up share of the ratings on suggestions.
- **Triage chips accepted**: share of triage chips that were applied rather than dismissed. When triage is
  off, the tile is replaced by a note (with a settings link for administrators).

A rate shows **—** until someone has reviewed something; it is never shown as 0% without reviews.

## Alert quality

The noisiest and the most flapping services over the last 30 days, using the same ranking as
**Settings > Intelligence > Dependencies & changes**. A service needs at least five incidents to be ranked.

Administrators get one-click fixes on each row:

- **Create suppression rule** opens Noise controls for that service.
- **Lower severity** opens the service's routing and severity settings.
- **Open Jira issue** files a "reduce alert noise" issue for the owning team (shown when Jira is set up).

Everyone else sees **View service**.

## Changes

- **Change-linked incidents**: incidents in the window that have a suggested change cause, and their share
  of all incidents.
- **Changes recorded**, and how many have a risk score.
- **Riskiest recent changes**, with a labelled band (high, medium or low risk) and the score. Risk ranks
  changes by how often similar changes were followed by an incident; it is not a verdict.
- **Recent change-linked incidents**, each with the change it may be linked to.

If no changes were recorded, administrators get a link to set up the change events webhook.

## Outcomes

**Mean time to acknowledge** and **mean time to resolve** for incidents opened in the window, with the change
against the window before it (for example "−20% vs previous 7d", marked better or worse). Two small charts
show both windows per hour (24h) or per day (7d and 30d), times in UTC. **Show data table** lists every
value.

## Lane health (administrators)

Whether the Intelligence lane on the instance serving the page is healthy, degraded (with the reason) or not
running there, and the shared work backlog: ready, running, oldest waiting and failed work. Use **Open
Intelligence settings** to replay failed work.

## When Intelligence is off

If the Intelligence master switch is off, the page says so at the top. Administrators get a link to turn it
on. Noise, alert quality and response times still show, because they do not depend on it.
