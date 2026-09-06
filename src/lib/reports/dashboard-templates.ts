/**
 * Dashboard Templates - Pre-built dashboard configurations
 *
 * These templates provide starting points for common use cases.
 * Users can clone templates to create their own customized dashboards.
 */

import type { WidgetDefinition } from './widget-registry';

export type TemplateWidget = {
  widgetType: WidgetDefinition['type'];
  metricKey: string;
  title?: string;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
};

export type DashboardTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  widgets: TemplateWidget[];
};

/**
 * Pre-built dashboard templates
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'executive-summary',
    name: 'Executive Summary',
    description: 'High-level operational health overview for leadership',
    icon: 'LayoutDashboard',
    color: '#8b5cf6',
    widgets: [
      // Row 1: Key Metrics
      {
        widgetType: 'metric',
        metricKey: 'totalIncidents',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'activeIncidents',
        position: { x: 1, y: 0, w: 1, h: 1 },
        config: {},
      },
      { widgetType: 'metric', metricKey: 'mttr', position: { x: 2, y: 0, w: 1, h: 1 }, config: {} },
      {
        widgetType: 'gauge',
        metricKey: 'ackCompliance',
        position: { x: 3, y: 0, w: 1, h: 1 },
        config: {},
      },
      // Row 2-3: Trend Chart
      {
        widgetType: 'chart',
        metricKey: 'trendSeries',
        title: 'Incident Trend',
        position: { x: 0, y: 1, w: 4, h: 2 },
        config: { chartType: 'count' },
      },
      // Row 4-5: Insights and Service Health
      {
        widgetType: 'insights',
        metricKey: 'insights',
        title: 'Smart Insights',
        position: { x: 0, y: 3, w: 2, h: 2 },
        config: {},
      },
      {
        widgetType: 'table',
        metricKey: 'serviceMetrics',
        title: 'Service Health',
        position: { x: 2, y: 3, w: 2, h: 2 },
        config: {},
      },
    ],
  },
  {
    id: 'sre-operations',
    name: 'SRE Operations',
    description: 'Detailed operational metrics for SRE and DevOps teams',
    icon: 'Terminal',
    color: '#10b981',
    widgets: [
      // Row 1: Active Status
      {
        widgetType: 'metric',
        metricKey: 'activeIncidents',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'unassignedActive',
        position: { x: 1, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'coveragePercent',
        position: { x: 2, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'escalationRate',
        position: { x: 3, y: 0, w: 1, h: 1 },
        config: {},
      },
      // Row 2-3: Response Performance
      {
        widgetType: 'chart',
        metricKey: 'trendSeries',
        title: 'MTTA vs MTTR',
        position: { x: 0, y: 1, w: 2, h: 2 },
        config: { chartType: 'mttaVsMttr' },
      },
      {
        widgetType: 'chart',
        metricKey: 'urgencyMix',
        title: 'Urgency Distribution',
        position: { x: 2, y: 1, w: 2, h: 2 },
        config: { chartType: 'pie' },
      },
      // Row 4-5: Heatmap
      {
        widgetType: 'chart',
        metricKey: 'heatmapData',
        title: 'Incident Calendar',
        position: { x: 0, y: 3, w: 4, h: 2 },
        config: { chartType: 'heatmap' },
      },
      // Row 6-7: Team Load
      {
        widgetType: 'table',
        metricKey: 'onCallLoad',
        title: 'On-Call Load',
        position: { x: 0, y: 5, w: 2, h: 2 },
        config: {},
      },
      {
        widgetType: 'table',
        metricKey: 'topServices',
        title: 'Top Services',
        position: { x: 2, y: 5, w: 2, h: 2 },
        config: {},
      },
    ],
  },
  {
    id: 'sla-performance',
    name: 'SLA Performance',
    description: 'SLA compliance tracking and breach analysis',
    icon: 'Shield',
    color: '#3b82f6',
    widgets: [
      // Row 1: SLA Metrics
      {
        widgetType: 'gauge',
        metricKey: 'ackCompliance',
        title: 'Ack Compliance',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'resolveCompliance',
        title: 'Resolve Compliance',
        position: { x: 1, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'ackBreaches',
        title: 'Ack Breaches',
        position: { x: 2, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'resolveBreaches',
        title: 'Resolve Breaches',
        position: { x: 3, y: 0, w: 1, h: 1 },
        config: {},
      },
      // Row 2-3: Compliance Trend
      {
        widgetType: 'chart',
        metricKey: 'trendSeries',
        title: 'SLA Compliance Trend',
        position: { x: 0, y: 1, w: 4, h: 2 },
        config: { chartType: 'slaCompliance' },
      },
      // Row 4: Response Times
      {
        widgetType: 'metric',
        metricKey: 'mttd',
        title: 'MTTA',
        position: { x: 0, y: 3, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'mttr',
        title: 'MTTR',
        position: { x: 1, y: 3, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'ackRate',
        title: 'Ack Rate',
        position: { x: 2, y: 3, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'resolveRate',
        title: 'Resolve Rate',
        position: { x: 3, y: 3, w: 1, h: 1 },
        config: {},
      },
      // Row 5-6: Service SLA Table
      {
        widgetType: 'table',
        metricKey: 'serviceSlaTable',
        title: 'Service SLA Compliance',
        position: { x: 0, y: 4, w: 4, h: 2 },
        config: {},
      },
    ],
  },
  {
    id: 'team-performance',
    name: 'Team Performance',
    description: 'Team workload and performance metrics',
    icon: 'Users',
    color: '#f59e0b',
    widgets: [
      // Row 1: Team Overview
      {
        widgetType: 'metric',
        metricKey: 'totalIncidents',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'resolveRate',
        position: { x: 1, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'coveragePercent',
        position: { x: 2, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'unassignedActive',
        position: { x: 3, y: 0, w: 1, h: 1 },
        config: {},
      },
      // Row 2-3: Assignee Distribution
      {
        widgetType: 'table',
        metricKey: 'assigneeLoad',
        title: 'Assignee Workload',
        position: { x: 0, y: 1, w: 2, h: 2 },
        config: {},
      },
      {
        widgetType: 'table',
        metricKey: 'onCallLoad',
        title: 'On-Call Distribution',
        position: { x: 2, y: 1, w: 2, h: 2 },
        config: {},
      },
      // Row 4-5: Trend and Insights
      {
        widgetType: 'chart',
        metricKey: 'trendSeries',
        title: 'Response Performance',
        position: { x: 0, y: 3, w: 2, h: 2 },
        config: { chartType: 'mttaVsMttr' },
      },
      {
        widgetType: 'insights',
        metricKey: 'insights',
        title: 'Insights',
        position: { x: 2, y: 3, w: 2, h: 2 },
        config: {},
      },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal Dashboard',
    description: 'Simple 4-metric overview for quick glance',
    icon: 'Minus',
    color: '#6b7280',
    widgets: [
      {
        widgetType: 'metric',
        metricKey: 'activeIncidents',
        title: 'Active',
        position: { x: 0, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'metric',
        metricKey: 'mttr',
        title: 'MTTR',
        position: { x: 1, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'ackCompliance',
        title: 'SLA',
        position: { x: 2, y: 0, w: 1, h: 1 },
        config: {},
      },
      {
        widgetType: 'gauge',
        metricKey: 'coveragePercent',
        title: 'Coverage',
        position: { x: 3, y: 0, w: 1, h: 1 },
        config: {},
      },
    ],
  },
];

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find(t => t.id === id);
}

/**
 * Get all template IDs
 */
export function getTemplateIds(): string[] {
  return DASHBOARD_TEMPLATES.map(t => t.id);
}
