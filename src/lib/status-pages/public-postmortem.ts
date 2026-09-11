type PublicTimelineEvent = {
  id: string;
  timestamp: string;
  type: 'DETECTION' | 'ESCALATION' | 'MITIGATION' | 'RESOLUTION';
  title: string;
  description: string;
};

type PublicImpactMetrics = {
  usersAffected?: number;
  downtimeMinutes?: number;
  errorRate?: number;
  servicesAffected?: string[];
  apiErrors?: number;
  performanceDegradation?: number;
};

export type PublicPostmortemSource = {
  title: string;
  summary?: string | null;
  timeline?: unknown;
  impact?: unknown;
  rootCause?: string | null;
  resolution?: string | null;
  lessons?: string | null;
  status: string;
  isPublic: boolean | null;
  createdAt: Date;
  publishedAt?: Date | null;
  incident: {
    id: string;
    title: string;
    resolvedAt?: Date | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function publicTimeline(value: unknown): PublicTimelineEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
    const title = typeof entry.title === 'string' ? entry.title : undefined;
    const description = typeof entry.description === 'string' ? entry.description : undefined;
    const type = entry.type;
    if (!timestamp || !title || !description) return [];
    if (
      type !== 'DETECTION' &&
      type !== 'ESCALATION' &&
      type !== 'MITIGATION' &&
      type !== 'RESOLUTION'
    ) {
      return [];
    }
    return [
      {
        id: `public-timeline-${index}`,
        timestamp,
        type,
        title,
        description,
      } satisfies PublicTimelineEvent,
    ];
  });
  return rows.length > 0 ? rows : undefined;
}

function publicImpact(value: unknown): PublicImpactMetrics | undefined {
  if (!isRecord(value)) return undefined;
  const metrics: PublicImpactMetrics = {};
  const usersAffected = finiteNumber(value.usersAffected);
  const downtimeMinutes = finiteNumber(value.downtimeMinutes);
  const errorRate = finiteNumber(value.errorRate);
  const apiErrors = finiteNumber(value.apiErrors);
  const performanceDegradation = finiteNumber(value.performanceDegradation);
  if (usersAffected !== undefined) metrics.usersAffected = usersAffected;
  if (downtimeMinutes !== undefined) metrics.downtimeMinutes = downtimeMinutes;
  if (errorRate !== undefined) metrics.errorRate = errorRate;
  if (apiErrors !== undefined) metrics.apiErrors = apiErrors;
  if (performanceDegradation !== undefined) {
    metrics.performanceDegradation = performanceDegradation;
  }
  if (Array.isArray(value.servicesAffected)) {
    metrics.servicesAffected = value.servicesAffected.filter(
      (service): service is string => typeof service === 'string'
    );
  }
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

/**
 * Public postmortem DTO. Internal responder identities, action items, Jira state,
 * SLA breach counts, revenue impact, and arbitrary extra JSON never cross the
 * server boundary to the public page.
 */
export function serializePublicPostmortem(postmortem: PublicPostmortemSource) {
  const timeline = publicTimeline(postmortem.timeline);
  const impact = publicImpact(postmortem.impact);

  return {
    // The public route is incident-addressed; do not expose the internal postmortem id.
    id: postmortem.incident.id,
    title: postmortem.title,
    summary: postmortem.summary ?? null,
    ...(timeline ? { timeline } : {}),
    ...(impact ? { impact } : {}),
    rootCause: postmortem.rootCause ?? null,
    resolution: postmortem.resolution ?? null,
    lessons: postmortem.lessons ?? null,
    status: 'PUBLISHED',
    isPublic: true,
    createdAt: postmortem.createdAt,
    publishedAt: postmortem.publishedAt ?? null,
    createdBy: {
      id: 'public-incident-response-team',
      name: 'Incident Response Team',
      email: '',
    },
    incident: {
      id: postmortem.incident.id,
      title: postmortem.incident.title,
      resolvedAt: postmortem.incident.resolvedAt ?? null,
    },
  };
}
