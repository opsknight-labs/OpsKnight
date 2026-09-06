/**
 * Widget Registry - Defines all available widget types for Executive Dashboards
 *
 * Each widget maps a metricKey from sla-server.ts to a visual component.
 * Widgets are categorized for easy browsing in the widget library.
 */

export type WidgetType = 'metric' | 'chart' | 'table' | 'gauge' | 'insights';

export type WidgetCategory = 'metrics' | 'charts' | 'tables' | 'special';

export type WidgetDefinition = {
  id: string;
  name: string;
  description: string;
  type: WidgetType;
  metricKey: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  icon: string;
  category: WidgetCategory;
  config?: Record<string, any>;
};

/**
 * Complete registry of available widgets
 */
export const WIDGET_REGISTRY: WidgetDefinition[] = [
  // ===== METRIC CARDS =====
  {
    id: 'total-incidents',
    name: 'Total Incidents',
    description: 'Total incident count for the selected period',
    type: 'metric',
    metricKey: 'totalIncidents',
    defaultSize: { w: 1, h: 1 },
    icon: 'AlertCircle',
    category: 'metrics',
  },
  {
    id: 'active-incidents',
    name: 'Active Incidents',
    description: 'Current actionable backlog (triggered + acknowledged)',
    type: 'metric',
    metricKey: 'activeIncidents',
    defaultSize: { w: 1, h: 1 },
    icon: 'Flame',
    category: 'metrics',
  },
  {
    id: 'mttr',
    name: 'MTTR',
    description: 'Mean Time To Resolve - average resolution time',
    type: 'metric',
    metricKey: 'mttr',
    defaultSize: { w: 1, h: 1 },
    icon: 'Clock',
    category: 'metrics',
  },
  {
    id: 'mtta',
    name: 'MTTA',
    description: 'Mean Time To Acknowledge - average response time',
    type: 'metric',
    metricKey: 'mttd',
    defaultSize: { w: 1, h: 1 },
    icon: 'Timer',
    category: 'metrics',
  },
  {
    id: 'ack-breaches',
    name: 'Ack Breaches',
    description: 'Incidents that breached acknowledgment SLA',
    type: 'metric',
    metricKey: 'ackBreaches',
    defaultSize: { w: 1, h: 1 },
    icon: 'AlertTriangle',
    category: 'metrics',
  },
  {
    id: 'resolve-breaches',
    name: 'Resolve Breaches',
    description: 'Incidents that breached resolution SLA',
    type: 'metric',
    metricKey: 'resolveBreaches',
    defaultSize: { w: 1, h: 1 },
    icon: 'AlertTriangle',
    category: 'metrics',
  },
  {
    id: 'escalation-rate',
    name: 'Escalation Rate',
    description: 'Percentage of incidents that were escalated',
    type: 'metric',
    metricKey: 'escalationRate',
    defaultSize: { w: 1, h: 1 },
    icon: 'TrendingUp',
    category: 'metrics',
  },
  {
    id: 'unassigned-active',
    name: 'Unassigned',
    description: 'Active incidents without an assignee',
    type: 'metric',
    metricKey: 'unassignedActive',
    defaultSize: { w: 1, h: 1 },
    icon: 'UserX',
    category: 'metrics',
  },
  {
    id: 'high-urgency-rate',
    name: 'High Urgency Rate',
    description: 'Percentage of high urgency incidents',
    type: 'metric',
    metricKey: 'highUrgencyRate',
    defaultSize: { w: 1, h: 1 },
    icon: 'Zap',
    category: 'metrics',
  },
  {
    id: 'after-hours-rate',
    name: 'After Hours Rate',
    description: 'Incidents occurring outside business hours',
    type: 'metric',
    metricKey: 'afterHoursRate',
    defaultSize: { w: 1, h: 1 },
    icon: 'Moon',
    category: 'metrics',
  },
  {
    id: 'coverage-gaps',
    name: 'Coverage Gaps',
    description: 'Days without on-call coverage',
    type: 'metric',
    metricKey: 'coverageGapDays',
    defaultSize: { w: 1, h: 1 },
    icon: 'AlertOctagon',
    category: 'metrics',
  },
  {
    id: 'mtbf',
    name: 'MTBF',
    description: 'Mean Time Between Failures',
    type: 'metric',
    metricKey: 'mtbfMs',
    defaultSize: { w: 1, h: 1 },
    icon: 'Activity',
    category: 'metrics',
  },

  // ===== GAUGE WIDGETS =====
  {
    id: 'ack-compliance',
    name: 'Ack SLA Compliance',
    description: 'Acknowledgment SLA compliance percentage',
    type: 'gauge',
    metricKey: 'ackCompliance',
    defaultSize: { w: 1, h: 1 },
    icon: 'Shield',
    category: 'metrics',
  },
  {
    id: 'resolve-compliance',
    name: 'Resolve SLA Compliance',
    description: 'Resolution SLA compliance percentage',
    type: 'gauge',
    metricKey: 'resolveCompliance',
    defaultSize: { w: 1, h: 1 },
    icon: 'ShieldCheck',
    category: 'metrics',
  },
  {
    id: 'coverage-percent',
    name: 'On-Call Coverage',
    description: 'Schedule coverage percentage (next 14 days)',
    type: 'gauge',
    metricKey: 'coveragePercent',
    defaultSize: { w: 1, h: 1 },
    icon: 'Users',
    category: 'metrics',
  },
  {
    id: 'ack-rate',
    name: 'Ack Rate',
    description: 'Percentage of incidents acknowledged',
    type: 'gauge',
    metricKey: 'ackRate',
    defaultSize: { w: 1, h: 1 },
    icon: 'CheckCircle',
    category: 'metrics',
  },
  {
    id: 'resolve-rate',
    name: 'Resolve Rate',
    description: 'Percentage of incidents resolved',
    type: 'gauge',
    metricKey: 'resolveRate',
    defaultSize: { w: 1, h: 1 },
    icon: 'CheckCircle2',
    category: 'metrics',
  },

  // ===== CHART WIDGETS =====
  {
    id: 'incident-trend',
    name: 'Incident Trend',
    description: 'Incident volume over time',
    type: 'chart',
    metricKey: 'trendSeries',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: 'LineChart',
    category: 'charts',
    config: { chartType: 'count' },
  },
  {
    id: 'mtta-mttr-trend',
    name: 'MTTA/MTTR Trend',
    description: 'Response and resolution times over time',
    type: 'chart',
    metricKey: 'trendSeries',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: 'Activity',
    category: 'charts',
    config: { chartType: 'mttaVsMttr' },
  },
  {
    id: 'sla-compliance-trend',
    name: 'SLA Compliance Trend',
    description: 'SLA compliance percentage over time',
    type: 'chart',
    metricKey: 'trendSeries',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: 'Shield',
    category: 'charts',
    config: { chartType: 'slaCompliance' },
  },
  {
    id: 'urgency-distribution',
    name: 'Urgency Distribution',
    description: 'Incidents by urgency level',
    type: 'chart',
    metricKey: 'urgencyMix',
    defaultSize: { w: 1, h: 2 },
    icon: 'PieChart',
    category: 'charts',
    config: { chartType: 'pie' },
  },
  {
    id: 'status-distribution',
    name: 'Status Distribution',
    description: 'Incidents by status',
    type: 'chart',
    metricKey: 'statusMix',
    defaultSize: { w: 1, h: 2 },
    icon: 'PieChart',
    category: 'charts',
    config: { chartType: 'pie' },
  },
  {
    id: 'incident-heatmap',
    name: 'Incident Heatmap',
    description: 'Calendar view of incident volume',
    type: 'chart',
    metricKey: 'heatmapData',
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    icon: 'Calendar',
    category: 'charts',
    config: { chartType: 'heatmap' },
  },

  // ===== TABLE WIDGETS =====
  {
    id: 'top-services',
    name: 'Top Services',
    description: 'Services ranked by incident count',
    type: 'table',
    metricKey: 'topServices',
    defaultSize: { w: 2, h: 2 },
    icon: 'Server',
    category: 'tables',
  },
  {
    id: 'assignee-load',
    name: 'Assignee Load',
    description: 'Workload distribution by assignee',
    type: 'table',
    metricKey: 'assigneeLoad',
    defaultSize: { w: 2, h: 2 },
    icon: 'Users',
    category: 'tables',
  },
  {
    id: 'service-health',
    name: 'Service Health',
    description: 'Health status and metrics by service',
    type: 'table',
    metricKey: 'serviceMetrics',
    defaultSize: { w: 2, h: 2 },
    icon: 'Activity',
    category: 'tables',
  },
  {
    id: 'on-call-load',
    name: 'On-Call Load',
    description: 'On-call responder workload',
    type: 'table',
    metricKey: 'onCallLoad',
    defaultSize: { w: 2, h: 2 },
    icon: 'Phone',
    category: 'tables',
  },
  {
    id: 'recurring-issues',
    name: 'Recurring Issues',
    description: 'Most frequent incident titles',
    type: 'table',
    metricKey: 'recurringTitles',
    defaultSize: { w: 2, h: 2 },
    icon: 'Repeat',
    category: 'tables',
  },
  {
    id: 'service-sla-table',
    name: 'Service SLA',
    description: 'SLA compliance by service',
    type: 'table',
    metricKey: 'serviceSlaTable',
    defaultSize: { w: 2, h: 2 },
    icon: 'Shield',
    category: 'tables',
  },

  // ===== SPECIAL WIDGETS =====
  {
    id: 'smart-insights',
    name: 'Smart Insights',
    description: 'AI-generated observations and recommendations',
    type: 'insights',
    metricKey: 'insights',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: 'Sparkles',
    category: 'special',
  },
  {
    id: 'current-on-call',
    name: 'Current On-Call',
    description: 'Who is on-call right now',
    type: 'table',
    metricKey: 'currentShifts',
    defaultSize: { w: 2, h: 1 },
    icon: 'UserCheck',
    category: 'special',
  },
];

/**
 * Get a widget definition by ID
 */
export function getWidgetById(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find(w => w.id === id);
}

/**
 * Get widgets filtered by category
 */
export function getWidgetsByCategory(category: WidgetCategory): WidgetDefinition[] {
  return WIDGET_REGISTRY.filter(w => w.category === category);
}

/**
 * Get widgets filtered by type
 */
export function getWidgetsByType(type: WidgetType): WidgetDefinition[] {
  return WIDGET_REGISTRY.filter(w => w.type === type);
}

/**
 * Get all categories with their widgets
 */
export function getWidgetsByCategories(): Record<WidgetCategory, WidgetDefinition[]> {
  return {
    metrics: getWidgetsByCategory('metrics'),
    charts: getWidgetsByCategory('charts'),
    tables: getWidgetsByCategory('tables'),
    special: getWidgetsByCategory('special'),
  };
}

/**
 * Get all widgets
 */
export function getAllWidgets(): WidgetDefinition[] {
  return WIDGET_REGISTRY;
}
