---
title: Manage a saved dashboard
description: Edit, persist, verify, and delete a saved OpsKnight dashboard without losing changes.
type: how-to
product_area: analytics
audience: [responder, administrator, operator]
reader:
  status: READER_COMPLETE
  task: Maintain a saved dashboard and its widgets.
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/reports/executive/DashboardViewer.tsx", "src/components/reports/DashboardGrid.tsx", "src/components/reports/WidgetLibrary.tsx", "src/app/api/dashboards/[id]/route.ts", "src/lib/reports/widget-registry.ts"]
---

# Manage a saved dashboard

## Before you begin

Open a saved dashboard that you own. Team/public visibility permits reading but does not grant edit or delete ownership.

## Open the feature

Open **Reports & Dashboards**, select the dashboard, open the gear menu, and choose **Edit Dashboard**.

## Configure dashboard metadata

Open a dashboard you own, select the gear menu, then **Edit Dashboard**. Edit mode exposes the name, description, drag handles, widget removal controls, **Add Widget**, **Cancel**, and **Save Changes**.

Changes stay in the browser until saved. The **Unsaved changes** label indicates that the title, description, widget set, or order differs from the last saved baseline.

![Saved dashboard in edit mode with editable metadata, drag handles, and save controls](/docs/v2.0.0/assets/dashboard-edit.png)

## How saved state works

The editor compares local title, description, widget definitions, positions, and configuration with the last saved baseline. Filter query parameters are separate display scope and are not included in that saved definition.

## Add and remove widgets

1. Select **Add Widget**.
2. Search by widget name/description/identifier or filter by category.
3. Select a widget. OpsKnight records its stable widget-definition identity as well as its metric and visual type so similarly sourced widgets keep the correct semantics after reload.
4. A checked, disabled tile is already on the dashboard. Each registered widget definition can appear once.
5. Close the library with **Done**.
6. To remove a widget, use its remove control while still in edit mode.

## Reorder and save

Drag a widget by its handle and drop it at the desired position. OpsKnight recalculates the grid order while retaining each widget's width and height. Keyboard dragging is supported by the grid interaction layer.

Select **Save Changes** only after reviewing the complete layout. A successful save displays confirmation and updates the saved baseline; reload the page and verify the order and definitions survived. **Cancel** restores the last saved title, description, widgets, and layout and exits edit mode.

For a template preview, **Done** exits editing but does not persist a new dashboard. Select **Clone Dashboard** first when you need a saved, editable copy.

## Visibility and ownership

The API supports `PRIVATE`, `TEAM`, and `PUBLIC` visibility. The current dashboard editor does not expose a visibility control. New blank and cloned dashboards therefore use the product's creation defaults unless another supported administrative/API workflow sets visibility. Only the owner can update or delete a saved dashboard; team/public access is read access.

## Delete a dashboard

1. Confirm you are on the saved dashboard, not a template preview.
2. Select the gear menu, then **Delete Dashboard**.
3. Read the confirmation and approve only after recording any configuration you need to reproduce.
4. OpsKnight deletes the dashboard and its widgets, then returns to **Reports & Dashboards**.

Deletion cannot be undone in the UI. **Export as PDF** and **Share Dashboard** are visible but disabled in 2.0.

## Verify saved changes

After **Save Changes** confirms success, reload the same URL. Confirm the name, description, widget count, identities, and order remain. Return to **Reports** and confirm its card carries the expected name and count.

## Troubleshooting

- **Save Changes is disabled:** make an actual title, description, widget, or ordering change.
- **A widget is disabled in the library:** that widget definition is already present.
- **Changes disappear:** verify this is a saved dashboard URL and that the save confirmation completed.
- **Edit or delete fails:** confirm the signed-in user owns the dashboard.

## Next steps

- [Read and filter dashboards](./read-dashboard)
- [Troubleshoot reports](./troubleshooting)
