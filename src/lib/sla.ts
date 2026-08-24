/**
 * Client-safe SLA utilities (pure functions, no database access)
 * For server-only functions that use Prisma, see ./sla-server.ts
 */

export type SLAMetrics = {
  // Retention metadata
  effectiveStart: Date;
  effectiveEnd: Date;
  requestedStart: Date;
  requestedEnd: Date;
  isClipped: boolean;
  retentionDays: number;

  // Incident Lifecycle (minutes)
  mttr: number | null;
  mttd: number | null;
  mtti: number | null;
  mttk: number | null;
  mttaP50: number | null;
  mttaP95: number | null;
  mttrP50: number | null;
  mttrP95: number | null;
  mtbfMs: number | null;

  // SLA Compliance
  ackCompliance: number | null;
  resolveCompliance: number | null;
  ackBreaches: number;
  resolveBreaches: number;

  // Counts
  totalIncidents: number;
  resolvedIncidents?: number;
  activeIncidents: number;
  unassignedActive: number;
  highUrgencyCount: number;
  mediumUrgencyCount: number;
  lowUrgencyCount: number;
  alertsCount: number;
  openCount: number;
  acknowledgedCount: number;
  snoozedCount: number;
  suppressedCount: number;
  resolved24h: number;
  dynamicStatus: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';
  activeCount: number;
  criticalCount: number;

  // Rates
  ackRate: number;
  resolveRate: number;
  highUrgencyRate: number;
  afterHoursRate: number;
  alertsPerIncident: number;
  escalationRate: number;
  reopenRate: number;
  autoResolveRate: number;

  previousPeriod: {
    totalIncidents: number;
    highUrgencyCount: number;
    /** Optional for backwards-compat — pre-PR consumers may not read these. */
    mediumUrgencyCount?: number;
    lowUrgencyCount?: number;
    mtta: number | null;
    mttr: number | null;
    ackRate: number;
    resolveRate: number;
  };

  // Coverage
  coveragePercent: number;
  coverageGapDays: number;
  onCallHoursMs: number;
  onCallUsersCount: number;
  activeOverrides: number;

  // Events
  autoResolvedCount: number;
  manualResolvedCount: number;
  eventsCount: number;

  // Golden Signals
  avgLatencyP99: number | null;
  errorRate: number | null;
  totalRequests: number;
  saturation: number | null;

  // Chart Data
  trendSeries: Array<{
    key: string;
    label: string;
    count: number;
    mtta: number;
    mttr: number;
    ackRate: number;
    resolveRate: number;
    ackCompliance: number;
    resolveCount: number;
    escalationRate: number;
  }>;
  statusMix: Array<{ status: string; count: number }>;
  urgencyMix: Array<{ urgency: string; count: number }>;
  topServices: Array<{ id: string; name: string; count: number }>;
  assigneeLoad: Array<{ id: string; name: string; count: number }>;
  statusAges: Array<{ status: string; avgMs: number | null }>;
  onCallLoad: Array<{ id: string; name: string; hoursMs: number; incidentCount: number }>;
  serviceSlaTable: Array<{
    id: string;
    name: string;
    ackRate: number;
    resolveRate: number;
    total: number;
  }>;

  // V2 Additions (V1 Parity)
  recurringTitles: Array<{ title: string; count: number }>;
  eventsPerIncident: number;
  heatmapData: Array<{ date: string; count: number }>;

  activeIncidentSummaries?: Array<{
    id: string;
    title: string;
    status: string;
    urgency: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    serviceId: string;
    serviceName: string;
    assigneeId: string | null;
    targetAckMinutes: number;
    targetResolveMinutes: number;
  }>;

  // New Enhanced Features
  serviceMetrics: Array<{
    id: string;
    name: string;
    count: number;
    mtta: number;
    mttr: number;
    slaBreaches: number;
    status: string;
    dynamicStatus: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';
    activeCount: number;
    criticalCount: number;
  }>;
  insights: Array<{
    type: 'positive' | 'negative';
    text: string;
  }>;
  currentShifts: Array<{
    id: string;
    userId?: string;
    scheduleId?: string;
    user: { name: string | null };
    schedule: { id?: string; name: string };
    start: Date;
    end: Date;
  }>;
  recentIncidents?: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    urgency: string;
    createdAt: Date;
    resolvedAt: Date | null;
    service: { id: string; name: string; region?: string | null };
  }>;
};

/**
 * Serialized version of recent incident for API responses.
 * Converts Date fields to ISO strings for JSON serialization.
 */
export type SerializedRecentIncident = Omit<
  NonNullable<SLAMetrics['recentIncidents']>[number],
  'createdAt' | 'resolvedAt'
> & {
  createdAt: string;
  resolvedAt: string | null;
};

/**
 * Serialized version of SLAMetrics for API responses.
 * All Date fields are converted to ISO strings for JSON serialization.
 */
export type SerializedSLAMetrics = Omit<
  SLAMetrics,
  'effectiveStart' | 'effectiveEnd' | 'requestedStart' | 'requestedEnd' | 'recentIncidents'
> & {
  effectiveStart: string;
  effectiveEnd: string;
  requestedStart: string;
  requestedEnd: string;
  recentIncidents?: SerializedRecentIncident[];
};

/**
 * Convert SLAMetrics to SerializedSLAMetrics for API responses.
 * Maps all Date fields to ISO string format.
 */
export function serializeSlaMetrics(metrics: SLAMetrics): SerializedSLAMetrics {
  return {
    ...metrics,
    effectiveStart:
      metrics.effectiveStart instanceof Date
        ? metrics.effectiveStart.toISOString()
        : String(metrics.effectiveStart),
    effectiveEnd:
      metrics.effectiveEnd instanceof Date
        ? metrics.effectiveEnd.toISOString()
        : String(metrics.effectiveEnd),
    requestedStart:
      metrics.requestedStart instanceof Date
        ? metrics.requestedStart.toISOString()
        : String(metrics.requestedStart),
    requestedEnd:
      metrics.requestedEnd instanceof Date
        ? metrics.requestedEnd.toISOString()
        : String(metrics.requestedEnd),
    recentIncidents: metrics.recentIncidents
      ? serializeRecentIncidents(metrics.recentIncidents)
      : undefined,
  };
}

/**
 * Serialize only the recentIncidents array from SLAMetrics.
 * Useful when only the incidents need to be serialized.
 */
export function serializeRecentIncidents(incidents?: any[] | null): SerializedRecentIncident[] {
  return (incidents || []).map(inc => ({
    ...inc,
    createdAt: inc.createdAt instanceof Date ? inc.createdAt.toISOString() : String(inc.createdAt),
    resolvedAt:
      inc.resolvedAt instanceof Date ? inc.resolvedAt.toISOString() : (inc.resolvedAt ?? null),
  }));
}

/**
 * Format time in minutes to human-readable string
 */
// Re-export for backward compatibility
export { formatTimeMinutes, formatTimeMinutesMs } from './time-format';

/**
 * Calculate Mean Time To Acknowledge (MTTA) for a single incident
 * Returns time in milliseconds
 */
export function calculateMTTA(incident: {
  acknowledgedAt: Date | null;
  createdAt: Date;
}): number | null {
  if (incident.acknowledgedAt && incident.createdAt) {
    return incident.acknowledgedAt.getTime() - incident.createdAt.getTime();
  }
  return null;
}

/**
 * Calculate Mean Time To Resolve (MTTR) for a single incident
 * Returns time in milliseconds
 */
export function calculateMTTR(incident: {
  resolvedAt: Date | null;
  createdAt: Date;
}): number | null {
  if (incident.resolvedAt && incident.createdAt) {
    return incident.resolvedAt.getTime() - incident.createdAt.getTime();
  }
  return null;
}

/**
 * Check if an incident met the acknowledgement SLA
 */
export function checkAckSLA(
  incident: { acknowledgedAt: Date | null; createdAt: Date },
  service: { targetAckMinutes?: number | null }
): boolean {
  if (!incident.acknowledgedAt || !incident.createdAt) return false;
  const ackTimeMinutes =
    (incident.acknowledgedAt.getTime() - incident.createdAt.getTime()) / 1000 / 60;
  const target = service.targetAckMinutes ?? 15; // Default to 15 minutes
  return ackTimeMinutes <= target;
}

/**
 * Check if an incident met the resolution SLA
 */
export function checkResolveSLA(
  incident: { resolvedAt: Date | null; createdAt: Date },
  service: { targetResolveMinutes?: number | null }
): boolean {
  if (!incident.resolvedAt || !incident.createdAt) return false;
  const resolveTimeMinutes =
    (incident.resolvedAt.getTime() - incident.createdAt.getTime()) / 1000 / 60;
  const target = service.targetResolveMinutes ?? 120; // Default to 120 minutes
  return resolveTimeMinutes <= target;
}
