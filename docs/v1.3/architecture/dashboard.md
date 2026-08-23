---
order: 1
---

# Dashboard Component Architecture

## Entry Point

The dashboard lives at `src/app/(app)/page.tsx`. It loads server data with Prisma and composes
modular UI widgets from `src/components/dashboard`.

Primary data sources:

- `calculateSLAMetrics` (`src/lib/sla-server.ts`)
- `getWidgetData` (`src/lib/widget-data-provider.ts`)
- Direct Prisma queries for incidents, services, users, and teams

---

## Component Structure

```
src/components/dashboard/
├── DashboardCommandCenter.tsx
├── DashboardIncidentFilters.tsx
├── MetricCard.tsx
├── QuickActionsPanel.tsx
├── OnCallWidget.tsx
├── SidebarWidget.tsx
├── SmartInsightsBanner.tsx
├── WidgetProvider.tsx
├── widgets/
│   ├── IncidentHeatmapWidget.tsx
│   └── SLABreachAlertsWidget.tsx
└── compact/
    ├── CompactPerformanceMetrics.tsx
    └── CompactTeamLoad.tsx
```

Additional dashboard helpers:

- `src/components/DashboardRealtimeWrapper.tsx`
- `src/hooks/useRealtime.ts` (SSE client for `/api/realtime/stream`)
- `src/app/(app)/page.module.css` (responsive layout overrides)

---

## How Data Flows

1. **Server load** (`page.tsx`): fetches incidents, services, teams, and users.
2. **Metrics**: `calculateSLAMetrics` provides SLA KPIs, trends, and breakdowns.
3. **Widget data**: `getWidgetData` uses SLA metrics as the source of truth and derives
   widget-specific views (service health, team load, breach alerts).
4. **Real-time refresh**: `DashboardRealtimeWrapper` listens to `/api/realtime/stream` and
   calls `router.refresh()` when new metrics or incidents arrive.

---

## Key Components and Responsibilities

- **DashboardCommandCenter**: hero metrics, KPIs, and top-line SLA stats.
- **DashboardIncidentFilters**: filters (status, service, assignee, urgency, date range).
- **QuickActionsPanel**: user greeting + common actions.
- **OnCallWidget**: current on-call shifts.
- **SidebarWidget**: shared container for right-column widgets.
- **SLABreachAlertsWidget**: upcoming SLA breach alerts (from `getWidgetData`).
- **IncidentHeatmapWidget**: incident volume by day.
- **CompactPerformanceMetrics / CompactTeamLoad**: compact rollups for teams.

---

## Styling

- Global styles: `src/styles/*`
- Dashboard-specific layout overrides: `src/app/(app)/page.module.css`
