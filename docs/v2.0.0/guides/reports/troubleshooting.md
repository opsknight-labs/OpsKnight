---
title: Troubleshoot reports and dashboards
description: Diagnose missing, empty, inaccessible, or unsaved dashboard state.
type: troubleshooting
product_area: analytics
audience: [responder, administrator, operator]
reader:
  status: READER_COMPLETE
  task: Restore a reports or dashboard workflow.
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/reports/executive/[id]/page.tsx", "src/app/(app)/reports/executive/DashboardViewer.tsx", "src/app/api/dashboards/route.ts", "src/app/api/dashboards/[id]/route.ts"]
---

# Troubleshoot reports and dashboards

## A dashboard is missing

- **Missing from My Dashboards:** that list contains dashboards owned by the signed-in user. Check **Select dashboard** for an accessible team/public dashboard.
- **Not found when opening a URL:** verify the ID and access. OpsKnight deliberately returns not found for nonexistent dashboards and dashboards that are neither owned, public, nor shared with one of the user's teams.
- **Created under another account:** private ownership does not follow role or email similarity. Sign in as the owner or recreate the dashboard.

## Widgets are empty or unexpected

Clear the team and service filters, widen the time range, and confirm matching incidents exist. Then verify the user can read the underlying services/teams. MTTA, MTTR, compliance, and comparison values need qualifying samples; absence is different from zero. Use the [metrics reference](../../reference/metrics) before treating two widgets as the same measure.

## A widget cannot be added

A checked widget-library tile means that exact widget definition is already present. Remove the existing widget before adding it again. If search returns nothing, clear the search and category filter.

## Changes did not persist

Confirm the page is a saved `/reports/executive/<id>` dashboard, not a template preview. In edit mode, wait for **Save Changes** to complete and its confirmation to appear. Reload immediately and verify title, description, widget identity, and order. A failed request leaves the unsaved state in the current browser session; do not navigate away before retrying. Only the owner can update the dashboard.

## Cancel behaved unexpectedly

**Cancel** restores the most recent saved baseline, not the original template from which the dashboard was cloned. If unwanted changes were already saved, manually restore the widgets or recreate the dashboard from the template.

## Deletion fails

Only the owner can delete a dashboard. Confirm ownership, retry once after a reload, and inspect application logs for the dashboard API failure. Deletion is permanent and removes associated widgets.
