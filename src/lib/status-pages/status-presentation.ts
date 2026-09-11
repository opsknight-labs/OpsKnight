import type { PublicServiceStatus } from './public-contract';

/** Canonical product policy for projecting incident urgency onto every public status surface. */
export function publicStatusForIncidentUrgency(urgency: string): PublicServiceStatus {
  switch (urgency) {
    case 'LOW':
      return 'DEGRADED';
    case 'MEDIUM':
      return 'PARTIAL_OUTAGE';
    case 'HIGH':
      return 'MAJOR_OUTAGE';
    default:
      return 'UNKNOWN';
  }
}

function statusRank(status: PublicServiceStatus): number {
  switch (status) {
    case 'OPERATIONAL':
      return 0;
    case 'UNKNOWN':
      return 1;
    case 'MAINTENANCE':
      return 2;
    case 'DEGRADED':
      return 3;
    case 'PARTIAL_OUTAGE':
      return 4;
    case 'MAJOR_OUTAGE':
      return 5;
  }
}

export const STATUS_PRESENTATION: Record<
  PublicServiceStatus,
  { label: string; token: string; icon: string }
> = {
  OPERATIONAL: { label: 'Operational', token: 'operational', icon: '✓' },
  DEGRADED: { label: 'Performance issues', token: 'degraded', icon: '⚠' },
  MAINTENANCE: { label: 'Under maintenance', token: 'maintenance', icon: '⚙' },
  PARTIAL_OUTAGE: { label: 'Limited availability', token: 'partial-outage', icon: '◐' },
  MAJOR_OUTAGE: { label: 'Outage', token: 'major-outage', icon: '✕' },
  UNKNOWN: { label: 'Unverified', token: 'unknown', icon: '?' },
};

export function normalizePublicStatus(value: unknown): PublicServiceStatus {
  switch (value) {
    case 'OPERATIONAL':
    case 'DEGRADED':
    case 'MAINTENANCE':
    case 'PARTIAL_OUTAGE':
    case 'MAJOR_OUTAGE':
    case 'UNKNOWN':
      return value;
    default:
      return 'UNKNOWN';
  }
}

export function getWorstPublicStatus(
  statuses: readonly PublicServiceStatus[]
): PublicServiceStatus {
  if (statuses.length === 0) return 'UNKNOWN';
  return statuses.reduce((worst, status) =>
    statusRank(status) > statusRank(worst) ? status : worst
  );
}

/** Worst status among services we actually have a signal for. */
export function worstKnownPublicStatus(
  statuses: readonly PublicServiceStatus[]
): PublicServiceStatus | null {
  const known = statuses.filter(status => status !== 'UNKNOWN');
  return known.length === 0 ? null : getWorstPublicStatus(known);
}

/** How much of the picture we can actually vouch for. */
export type PublicHealthConfidence = 'complete' | 'partial' | 'none';

export type OverallPublicHealth = {
  status: PublicServiceStatus;
  knownServiceCount: number;
  unknownServiceCount: number;
  confidence: PublicHealthConfidence;
  /** Primary line for the page header. */
  headline: string;
  /** Secondary caveat, present only when some services could not be verified. */
  note: string | null;
};

/**
 * Summarize a page's services, keeping health and data confidence separate.
 *
 * Ranking UNKNOWN as a severity makes a single unverifiable service dominate an otherwise healthy
 * page, which overstates the problem; ignoring it understates one. Neither is acceptable, so
 * severity is computed from the services we have a signal for and missing signal is reported
 * alongside it as a caveat. Two invariants follow, and are asserted in the tests: adding UNKNOWN
 * services can never reduce the reported severity, and a page with no signal at all never reports
 * itself operational.
 */
export function deriveOverallPublicHealth(
  services: ReadonlyArray<{ status: PublicServiceStatus }>
): OverallPublicHealth {
  const statuses = services.map(service => service.status);
  const unknownServiceCount = statuses.filter(status => status === 'UNKNOWN').length;
  const knownServiceCount = statuses.length - unknownServiceCount;

  if (statuses.length === 0) {
    return {
      status: 'OPERATIONAL',
      knownServiceCount: 0,
      unknownServiceCount: 0,
      confidence: 'complete',
      headline: 'No services published',
      note: null,
    };
  }

  if (knownServiceCount === 0) {
    return {
      status: 'UNKNOWN',
      knownServiceCount: 0,
      unknownServiceCount,
      confidence: 'none',
      headline: 'Current status unavailable',
      note: 'We could not verify service health just now. This page refreshes automatically.',
    };
  }

  const worst = worstKnownPublicStatus(statuses) ?? 'OPERATIONAL';
  const worstCount = statuses.filter(status => status === worst).length;
  const plural = unknownServiceCount === 1 ? 'service' : 'services';
  return {
    status: worst,
    knownServiceCount,
    unknownServiceCount,
    confidence: unknownServiceCount === 0 ? 'complete' : 'partial',
    headline: overallHeadline(worst, {
      knownServiceCount,
      unknownServiceCount,
      worstCount,
    }),
    note:
      unknownServiceCount === 0
        ? null
        : `Status unverified for ${unknownServiceCount} additional ${plural}.`,
  };
}

export function overallHeadline(
  worst: PublicServiceStatus,
  counts: { knownServiceCount: number; unknownServiceCount: number; worstCount: number }
): string {
  if (worst === 'OPERATIONAL') {
    return counts.unknownServiceCount === 0
      ? 'All systems operational'
      : 'All known systems operational';
  }

  const scope =
    counts.worstCount === 1
      ? 'One service'
      : counts.worstCount === counts.knownServiceCount
        ? 'All services'
        : 'Some services';

  switch (worst) {
    case 'MAJOR_OUTAGE':
      return `${scope} ${counts.worstCount === 1 ? 'is' : 'are'} experiencing an outage`;
    case 'PARTIAL_OUTAGE':
      return counts.worstCount === 1
        ? 'One service has limited availability'
        : `${scope} have limited availability`;
    case 'DEGRADED':
      return counts.worstCount === 1
        ? 'One service has performance issues'
        : counts.worstCount === counts.knownServiceCount
          ? 'Performance issues'
          : 'Some services have performance issues';
    case 'MAINTENANCE':
      return counts.worstCount === 1
        ? 'One service is under maintenance'
        : 'Maintenance in progress';
    case 'UNKNOWN':
      return OVERALL_HEADLINE.UNKNOWN;
  }
}

/** Page-level headline from snapshot status fields, without recomputing health. */
export function presentOverallHeadline(
  overall: OverallPublicHealth,
  serviceStatuses: readonly PublicServiceStatus[]
): string {
  if (serviceStatuses.length === 0 || overall.confidence === 'none') {
    return overall.headline;
  }
  return overallHeadline(overall.status, {
    knownServiceCount: overall.knownServiceCount,
    unknownServiceCount: overall.unknownServiceCount,
    worstCount: Math.max(1, serviceStatuses.filter(status => status === overall.status).length),
  });
}

/**
 * Generic header copy per status. Count-aware page headlines are built in `deriveOverallPublicHealth`
 * so one down service never reads as the whole page being unavailable.
 */
export const OVERALL_HEADLINE: Record<PublicServiceStatus, string> = {
  OPERATIONAL: 'All systems operational',
  MAINTENANCE: 'Maintenance in progress',
  DEGRADED: 'Performance issues',
  PARTIAL_OUTAGE: 'Limited availability',
  MAJOR_OUTAGE: 'Outage detected',
  UNKNOWN: 'Status unavailable',
};

/**
 * The four-value vocabulary the public API used before partial outage and unknown existed.
 *
 * Emitted alongside the canonical value so an integrator switching on the old set keeps working:
 * PARTIAL_OUTAGE and MAJOR_OUTAGE both fold to `outage`, and UNKNOWN folds to `degraded` because
 * "we cannot verify this" must never be reported to an existing consumer as healthy.
 */
export type LegacyPublicStatus = 'operational' | 'degraded' | 'maintenance' | 'outage';

export function legacyPublicStatus(status: PublicServiceStatus): LegacyPublicStatus {
  switch (status) {
    case 'OPERATIONAL':
      return 'operational';
    case 'MAINTENANCE':
      return 'maintenance';
    case 'PARTIAL_OUTAGE':
    case 'MAJOR_OUTAGE':
      return 'outage';
    case 'DEGRADED':
    case 'UNKNOWN':
      return 'degraded';
  }
}

/** Supporting sentence under the headline. */
export const OVERALL_DETAIL: Record<PublicServiceStatus, string> = {
  OPERATIONAL: 'All published services are operating normally.',
  MAINTENANCE: 'Planned work is in progress on one or more services.',
  DEGRADED: 'At least one service is slower or less reliable than usual.',
  PARTIAL_OUTAGE: 'At least one service has limited functionality.',
  MAJOR_OUTAGE: 'One or more services are currently experiencing an outage.',
  UNKNOWN: 'We cannot verify service health right now.',
};

export function statusPresentation(status: PublicServiceStatus) {
  switch (status) {
    case 'OPERATIONAL':
      return STATUS_PRESENTATION.OPERATIONAL;
    case 'DEGRADED':
      return STATUS_PRESENTATION.DEGRADED;
    case 'MAINTENANCE':
      return STATUS_PRESENTATION.MAINTENANCE;
    case 'PARTIAL_OUTAGE':
      return STATUS_PRESENTATION.PARTIAL_OUTAGE;
    case 'MAJOR_OUTAGE':
      return STATUS_PRESENTATION.MAJOR_OUTAGE;
    case 'UNKNOWN':
      return STATUS_PRESENTATION.UNKNOWN;
  }
}
