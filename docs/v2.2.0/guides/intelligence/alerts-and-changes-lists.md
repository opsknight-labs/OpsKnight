---
title: Browse alerts and changes
description: List every alert with what the noise controls did to it, and every recorded change with its risk score and linked incidents.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Find an alert or a change by service, severity, noise decision, source, risk or time, and open it.
verification:
  level: test
  verified_at: 2026-11-11
  evidence:
    [
      src/app/(app)/alerts/page.tsx,
      src/app/(app)/changes/page.tsx,
      src/lib/intelligence/lists,
      tests/integration/intelligence/lists.test.ts,
      tests/components/intelligence-lists.test.tsx,
      tests/unit/intelligence-lists-contract.test.ts,
      tests/e2e/intelligence-overview.spec.ts,
    ]
---

# Browse alerts and changes

**Alerts** and **Changes** are in the main navigation, under Runbooks. Administrators, responders and
auditors can open them. Both pages only read data, and both show only what you can already open: if
your access is limited to your teams, you see your teams' services only.

Both lists are newest first and show the last 24 hours until you pick another time range (24 hours,
7 days or 30 days). Filters are part of the address, so a filtered view can be shared as a link.
Each page holds up to 50 rows. **Next page** continues from the last row; **First page** returns to
the newest.

## Alerts

Go to `/alerts`. Each row shows:

- the alert's summary (opens the alert) and, when the alert opened or joined an incident, **Open
  incident**;
- the **service** and the **severity** the integration sent;
- up to four **labels**, with a count of the rest;
- the **noise decision**, if a noise control acted on the alert before paging, and the rule or window
  that made it:
  - **Suppressed**: a suppression or orchestration rule held it back or dropped it;
  - **Deduplicated**: it was appended to an open incident with the same content;
  - **Grouped**: it was grouped under a parent incident during a storm;
  - **Maintenance**: a maintenance window covered it;
  - **Held**, **Downgraded** or **Transformed** for the other controls;
- when it was **received** (UTC).

A decision shown as **Shadow: …** was recorded by a control in shadow mode. It describes what would
have happened; the alert itself was not affected. A row has no decision chip when no control acted.

Filter by **service**, **severity**, **noise decision** and **time range**. Filtering by decision
lists alerts in the order the decisions were made.

An alert that never opened an incident (for example one a suppression rule held back) still opens:
its page shows the service, severity and the decision with its reason.

To change a decision, change the rule that made it under **Settings > Intelligence > Noise
controls**, or ungroup the alert from its incident. See
[noise decisions on incidents](./incidents-and-lists.md).

## Changes

Go to `/changes`. Each row shows:

- the change's summary (opens the change), its **kind** (deploy, config, feature flag or infra) and
  version;
- the **source** that reported it and the **service** it belongs to, or **No service**;
- its **risk**: a labelled band (high, medium or low) with the score, or **Not scored**. Risk ranks
  changes by how often similar changes were followed by an incident. It is a signal for where to look
  first, never a statement that a change caused an incident;
- **linked incidents**: incidents you can open whose analysis points at this change as a possible
  cause. Up to three are listed, with a count of the rest;
- when it happened (UTC).

Filter by **service**, **source**, **risk** and **time range**.

Changes that are not tied to a service are visible to people who can read every service. If your
access is limited to your teams, you see changes of your teams' services.

Linked incidents are looked up among the 500 most recent incidents opened in the page's time span;
the page says so when that limit was reached.

## On a phone

Both pages work at phone width: the service, severity, decision, risk and time fold under the
summary, and every row link is at least 44 px tall.
