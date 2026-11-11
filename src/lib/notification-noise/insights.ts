/**
 * Deterministic notification suggestions. Pure functions over plain data: no store, no database, no
 * model. Each item is shaped for the shared operations-insight store (key, severity, title, summary,
 * evidence, draftHref) plus its `kind`, so a producer can hand them to `upsertInsights` unchanged.
 * `draftHref` only opens the existing editor; nothing here changes a setting.
 */
import { AUTO_RESOLVE_WINDOW_MINUTES, share, type NoiseReport } from './report';

export const NOISE_INSIGHT_KINDS = {
  lowValueSource: 'notification.low_value_source',
  quietHours: 'notification.quiet_hours',
  unhealthyEndpoint: 'notification.unhealthy_endpoint',
} as const;
export type NoiseInsightKind = (typeof NOISE_INSIGHT_KINDS)[keyof typeof NOISE_INSIGHT_KINDS];

export interface NoiseInsightItem {
  key: string;
  kind: NoiseInsightKind;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  summary: string;
  evidence: { window: string; facts: Array<{ label: string; value: string }> };
  draftHref: string;
}

export const NOISE_INSIGHT_THRESHOLDS = {
  /** Fewer pages than this is not a pattern. */
  minPages: 5,
  /** A source is low value when at most this share of its pages was acted on... */
  maxActedPercent: 20,
  /** ...or at least this share resolved by itself within minutes. */
  minAutoResolvedPercent: 50,
  /** Local hours treated as night, start inclusive, end exclusive, wrapping midnight. */
  nightStartHour: 22,
  nightEndHour: 7,
  maxLowValueSources: 5,
} as const;

const windowLabel = (report: NoiseReport) => `last ${report.days} days`;

/** Services whose pages the person almost never acts on, or that mostly resolve by themselves. */
export function lowValueSourceInsights(report: NoiseReport): NoiseInsightItem[] {
  const t = NOISE_INSIGHT_THRESHOLDS;
  return report.byService
    .filter(
      service =>
        service.pages >= t.minPages &&
        (share(service.acted, service.pages) <= t.maxActedPercent ||
          share(service.autoResolved, service.pages) >= t.minAutoResolvedPercent)
    )
    .slice(0, t.maxLowValueSources)
    .map(service => ({
      key: service.serviceId,
      kind: NOISE_INSIGHT_KINDS.lowValueSource,
      severity: 'INFO' as const,
      title: `${service.serviceName} pages you but rarely needs you`.slice(0, 140),
      summary: `You acted on ${service.acted} of ${service.pages} pages. Consider lowering its urgency or moving it to a digest.`,
      evidence: {
        window: windowLabel(report),
        facts: [
          { label: 'Pages received', value: String(service.pages) },
          {
            label: 'Acted on',
            value: `${service.acted} (${share(service.acted, service.pages)}%)`,
          },
          {
            label: `Resolved by itself within ${AUTO_RESOLVE_WINDOW_MINUTES} minutes`,
            value: `${service.autoResolved} (${share(service.autoResolved, service.pages)}%)`,
          },
        ],
      },
      draftHref: `/services/${encodeURIComponent(service.serviceId)}/notifications`,
    }));
}

function isNight(hour: number): boolean {
  const { nightStartHour, nightEndHour } = NOISE_INSIGHT_THRESHOLDS;
  return hour >= nightStartHour || hour < nightEndHour;
}

/** Night pages that are almost never acted on, for a person who has quiet hours off. */
export function quietHoursInsights(
  report: NoiseReport,
  preferences: { quietHoursEnabled: boolean }
): NoiseInsightItem[] {
  if (preferences.quietHoursEnabled) return [];
  const t = NOISE_INSIGHT_THRESHOLDS;
  const night = report.byHour.filter(entry => isNight(entry.hour));
  const pages = night.reduce((sum, entry) => sum + entry.pages, 0);
  const acted = night.reduce((sum, entry) => sum + entry.acted, 0);
  if (pages < t.minPages || share(acted, pages) > t.maxActedPercent) return [];
  const hours = `${t.nightStartHour}:00 to 0${t.nightEndHour}:00`;
  return [
    {
      key: 'night',
      kind: NOISE_INSIGHT_KINDS.quietHours,
      severity: 'INFO',
      title: 'Night pages you rarely act on',
      summary: `You acted on ${acted} of ${pages} pages between ${hours}. Quiet hours hold low-urgency pages overnight; high-urgency pages still come through.`,
      evidence: {
        window: windowLabel(report),
        facts: [
          { label: `Pages between ${hours}`, value: String(pages) },
          { label: 'Acted on', value: `${acted} (${share(acted, pages)}%)` },
        ],
      },
      draftHref: '/settings/profile?tab=schedule',
    },
  ];
}

export interface NoiseEndpoint {
  channel: string;
  status: string;
  failureCount: number;
  lastErrorCode?: string | null;
}

const ENDPOINT_PROBLEMS: Record<string, { label: string; severity: 'WARNING' | 'CRITICAL' }> = {
  DEGRADED: { label: 'is failing intermittently', severity: 'WARNING' },
  INVALID: { label: 'has an invalid address', severity: 'CRITICAL' },
  BOUNCED: { label: 'is bouncing', severity: 'CRITICAL' },
  OPTED_OUT: { label: 'has opted out', severity: 'CRITICAL' },
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  VOICE: 'Voice',
  PUSH: 'Push',
  WHATSAPP: 'WhatsApp',
};

/** Channels that cannot currently reach the person. */
export function unhealthyEndpointInsights(endpoints: readonly NoiseEndpoint[]): NoiseInsightItem[] {
  return endpoints.flatMap(endpoint => {
    const problem = ENDPOINT_PROBLEMS[endpoint.status];
    if (!problem) return [];
    const channel = CHANNEL_LABELS[endpoint.channel] ?? endpoint.channel;
    return [
      {
        key: endpoint.channel,
        kind: NOISE_INSIGHT_KINDS.unhealthyEndpoint,
        severity: problem.severity,
        title: `${channel} ${problem.label}`,
        summary: `Pages sent to you by ${channel} may not arrive. Check the address and send a test.`,
        evidence: {
          window: 'current state',
          facts: [
            { label: 'Status', value: endpoint.status },
            { label: 'Consecutive failures', value: String(endpoint.failureCount) },
            ...(endpoint.lastErrorCode
              ? [{ label: 'Last error', value: endpoint.lastErrorCode.slice(0, 160) }]
              : []),
          ],
        },
        draftHref: '/settings/profile?tab=notifications',
      },
    ];
  });
}

/** Everything worth saying about one person's notifications, most severe first. */
export function notificationNoiseInsights(input: {
  report: NoiseReport;
  quietHoursEnabled: boolean;
  endpoints: readonly NoiseEndpoint[];
}): NoiseInsightItem[] {
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return [
    ...unhealthyEndpointInsights(input.endpoints),
    ...lowValueSourceInsights(input.report),
    ...quietHoursInsights(input.report, input),
  ].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
