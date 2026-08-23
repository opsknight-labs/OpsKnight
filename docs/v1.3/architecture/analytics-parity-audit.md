---
order: 4
---

# Analytics Coverage Audit (current code)

This page documents what exists **today** across analytics surfaces. All statements are derived
from the current codebase in `OpsKnight/`.

---

## Surfaces Reviewed

- **Desktop analytics**: `/analytics` → `src/app/(app)/analytics/page.tsx`
- **Mobile analytics**: `/m/analytics` → `src/app/(mobile)/m/analytics/page.tsx`
- **Executive report**: `/reports/executive` → `src/app/(app)/reports/executive/page.tsx`
- **Export API**: `/api/analytics/export` → `src/app/api/analytics/export/route.ts`

All analytics calculations come from `calculateSLAMetrics` in `src/lib/sla-server.ts`.

---

## Filters & Scope

### Desktop analytics (/analytics)

- Filters: team, service, assignee, status, urgency, window
- Uses: `calculateSLAMetrics` with the full filter set
- Export: builds URL with all active filters via `buildAnalyticsExportUrl`

### Mobile analytics (/m/analytics)

- Filters: none (fixed window)
- Uses: `calculateSLAMetrics({ windowDays: 7 })`
- Export: none

### Executive report (/reports/executive)

- Filters: team, service, window (via query params)
- Uses: `calculateSLAMetrics({ windowDays, teamId, serviceId })`
- Export: none

### Export API (/api/analytics/export)

- Accepts: team, service, assignee, status, urgency, window
- Uses: `calculateSLAMetrics` + incident queries to build CSV

---

## Access Control

- **Desktop analytics**: requires authenticated session (no explicit role gate)
- **Mobile analytics**: requires authenticated session (enforced in `src/app/(mobile)/m/layout.tsx`)
- **Executive report**: requires authenticated session (no explicit role gate)
- **Export API**: requires `responder` role or above (`assertResponderOrAbove`)

---

## Metric Coverage (by surface)

All surfaces share the same SLA engine but expose different subsets in UI:

- **Desktop analytics**: full KPI grid, trends, service health table, heatmap, insights feed
- **Mobile analytics**: compact four-card summary (open, new, MTTA, MTTR)
- **Executive report**: template-driven widgets (uses `src/lib/reports/dashboard-templates.ts`)

---

## Current Gaps

- **Role parity**: export is restricted to responders/admins; analytics pages are session-only.
- **Filter parity**: mobile analytics is fixed to a 7-day window and does not expose filters.
- **Export parity**: only desktop analytics exposes export in UI; executive report and mobile do not.

---

## Suggested Follow-ups

1. Decide whether analytics pages should enforce responder/admin role like export.
2. Decide if mobile analytics should add filters or remain a quick summary view.
3. Decide if executive report should offer export (CSV/PDF) based on report templates.
