import type {
  PublicRegionStatus,
  PublicServiceStatus,
  PublicStatusService,
  PublicUptimeGrade,
  PublicUptimeWindow,
} from './public-contract';
import { STATUS_PRESENTATION, statusPresentation } from './status-presentation';

/** Bucket label for a service with no region recorded. */
export const GLOBAL_REGION_LABEL = 'Global';
/** Bucket label for a service that spans more than one region. */
export const MULTI_REGION_LABEL = 'Multi-region';

/**
 * Which bucket a service belongs to when services are grouped by region.
 *
 * A service is listed once, always. Grouping by membership instead renders a service in three
 * regions three times, which reads as three separate outages during an incident.
 */
export function serviceRegionBucket(regions: readonly string[] | undefined): string {
  const named = (regions ?? []).map(region => region.trim()).filter(Boolean);
  if (named.length === 0) return GLOBAL_REGION_LABEL;
  if (named.length === 1) return named[0];
  return MULTI_REGION_LABEL;
}

export type StatusServiceGroup<T> = {
  region: string;
  services: T[];
  status: PublicServiceStatus;
};

/**
 * Group services into single-occupancy buckets, named regions first.
 *
 * `Global` and `Multi-region` sort last because they are catch-alls; a reader scanning for a
 * specific region should not have to look past them.
 */
export function groupServicesByRegion<T extends Pick<PublicStatusService, 'regions' | 'status'>>(
  services: readonly T[],
  worst: (statuses: readonly PublicServiceStatus[]) => PublicServiceStatus
): StatusServiceGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const service of services) {
    const bucket = serviceRegionBucket(service.regions);
    const members = buckets.get(bucket) ?? [];
    members.push(service);
    buckets.set(bucket, members);
  }
  const rank = (region: string) =>
    region === MULTI_REGION_LABEL ? 2 : region === GLOBAL_REGION_LABEL ? 1 : 0;
  return [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([region, members]) => ({
      region,
      services: members,
      status: worst(members.map(service => service.status)),
    }));
}

/** Lowercased haystack for client-side filtering, built once per service rather than per keystroke. */
export function serviceSearchKey(service: PublicStatusService): string {
  return [
    service.name,
    service.description ?? '',
    service.team?.name ?? '',
    service.slaTier ?? '',
    ...(service.regions ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

export type UptimeTier = 'excellent' | 'good' | 'poor' | 'unknown';

/** Where a window's availability sits against the page's configured SLA thresholds. */
export function uptimeTier(
  window: PublicUptimeWindow | undefined,
  thresholds: { excellent: number; good: number }
): UptimeTier {
  if (!window || window.percentage === null) return 'unknown';
  if (window.percentage >= thresholds.excellent) return 'excellent';
  if (window.percentage >= thresholds.good) return 'good';
  return 'poor';
}

export const UPTIME_TIER_LABEL: Record<UptimeTier, string> = {
  excellent: 'SLA Excellent',
  good: 'SLA Good',
  poor: 'Below SLA',
  unknown: 'No SLA data',
};

/**
 * Canonical, backend-owned uptime grade for the public contract. Returns undefined when there is
 * no measurement to grade, so the UI never has to decide what "Excellent" means.
 */
export function publicUptimeGrade(
  percentage: number | null | undefined,
  thresholds: { excellent: number; good: number }
): PublicUptimeGrade | undefined {
  if (percentage === null || percentage === undefined) return undefined;
  if (percentage >= thresholds.excellent) return 'EXCELLENT';
  if (percentage >= thresholds.good) return 'GOOD';
  return 'BELOW_TARGET';
}

/**
 * How to present one uptime window.
 *
 * Twenty days of real measurement is data, not an absence of data, so a short window reports its
 * percentage and says how much it covers. "Unavailable" is reserved for genuinely uncomputable.
 */
export function describeUptimeWindow(window: PublicUptimeWindow | undefined): {
  value: string;
  coverage: string | null;
  partial: boolean;
  meterPercent: number;
} {
  if (!window || window.percentage === null) {
    return { value: 'Unavailable', coverage: null, partial: false, meterPercent: 0 };
  }
  const days = Math.max(0, Math.floor(window.measuredDays));
  return {
    value: `${window.percentage.toFixed(3)}%`,
    coverage: window.complete ? null : `${days} ${days === 1 ? 'day' : 'days'} of available data`,
    partial: !window.complete,
    meterPercent: Math.max(0, Math.min(100, window.percentage)),
  };
}

/** Plain-language region summary, in place of six counters that are almost always zero. */
export function describeRegion(region: PublicRegionStatus): string {
  const services = `${region.totalServices} ${region.totalServices === 1 ? 'service' : 'services'}`;
  if (region.impactedServices === 0 && region.unknownServices === 0) {
    return `${services} · All systems healthy`;
  }
  const parts: string[] = [services];
  const impacted = region.impactedServices - region.unknownServices;
  if (impacted > 0) parts.push(`${impacted} impacted`);
  if (region.unknownServices > 0) parts.push(`${region.unknownServices} status unavailable`);
  return parts.join(' · ');
}

/** Counter breakdown for the region disclosure, with empty categories omitted. */
export function regionBreakdown(
  region: PublicRegionStatus
): Array<{ label: string; count: number }> {
  return (
    [
      ['OPERATIONAL', region.operationalServices],
      ['DEGRADED', region.degradedServices],
      ['MAINTENANCE', region.maintenanceServices],
      ['PARTIAL_OUTAGE', region.partialOutageServices],
      ['MAJOR_OUTAGE', region.majorOutageServices],
      ['UNKNOWN', region.unknownServices],
    ] as Array<[PublicServiceStatus, number]>
  )
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ label: statusPresentation(status).label, count }));
}

/** Legend entries for the history inspector, in severity order. */
export const HISTORY_LEGEND = (
  ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE', 'UNKNOWN'] as const
).map(status => ({ status, label: STATUS_PRESENTATION[status].label }));
