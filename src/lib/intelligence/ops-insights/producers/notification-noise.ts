import 'server-only';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import {
  AUTO_RESOLVE_WINDOW_MINUTES,
  NOISE_REPORT_DAYS,
  noiseWindow,
  share,
  toNoiseDailyRows,
} from '@/lib/notification-noise/report';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Notification noise (plan J6), read only from the daily pages rollups, never from raw Notification rows.
 *
 * - USER: a service that pages the person but rarely needs them (move it to a digest or low urgency), night
 *   pages they rarely act on while quiet hours are off, and a channel that cannot reach them.
 * - SERVICE: the same low-value test summed over everyone the service paged.
 *
 * Stored text names no service: a team owner may read a person's insights without being able to read every
 * service that paged them. The service is an id in the draft link; the Noise section names it on read.
 */
export const NOISE_INSIGHT_THRESHOLDS = {
  /** Fewer pages than this is not a pattern. */
  minPages: 5,
  /** At service scope, pages summed over people. */
  minServicePages: 20,
  /** A source is low value when at most this share of its pages was acted on... */
  maxActedPercent: 20,
  /** ...or at least this share resolved by itself within minutes. */
  minAutoResolvedPercent: 50,
  /** Local hours treated as night, start inclusive, end exclusive, wrapping midnight. */
  nightStartHour: 22,
  nightEndHour: 7,
  maxLowValueSources: 5,
} as const;

interface Counts {
  pages: number;
  acted: number;
  autoResolved: number;
}

export interface UserNoiseInput {
  /** Busiest first, at most maxLowValueSources candidates. */
  services: Array<Counts & { serviceId: string }>;
  night: Counts;
  quietHoursEnabled: boolean;
  endpoints: Array<{ channel: string; status: string; failureCount: number }>;
}

export interface ServiceNoiseInput extends Counts {
  serviceId: string;
}

const t = NOISE_INSIGHT_THRESHOLDS;
const WINDOW = `last ${NOISE_REPORT_DAYS} days`;
const isNight = (hour: number) => hour >= t.nightStartHour || hour < t.nightEndHour;
const lowValue = (counts: Counts, minPages: number) =>
  counts.pages >= minPages &&
  (share(counts.acted, counts.pages) <= t.maxActedPercent ||
    share(counts.autoResolved, counts.pages) >= t.minAutoResolvedPercent);
const pct = (part: number, whole: number) => `${part} (${share(part, whole)}%)`;
const facts = (counts: Counts) => [
  { label: 'Pages', value: String(counts.pages) },
  { label: 'Acted on', value: pct(counts.acted, counts.pages) },
  {
    label: `Resolved by itself within ${AUTO_RESOLVE_WINDOW_MINUTES} minutes`,
    value: pct(counts.autoResolved, counts.pages),
  },
];
const serviceNotifications = (serviceId: string) =>
  `/services/${encodeURIComponent(serviceId)}/notifications`;

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

export function deriveUserNoise(input: UserNoiseInput): OpsInsightItem[] {
  const items: OpsInsightItem[] = [];
  for (const endpoint of input.endpoints) {
    const problem = ENDPOINT_PROBLEMS[endpoint.status];
    if (!problem) continue;
    const channel = CHANNEL_LABELS[endpoint.channel] ?? endpoint.channel;
    items.push({
      key: `endpoint:${endpoint.channel}`,
      severity: problem.severity,
      title: `${channel} ${problem.label}`,
      summary: `Pages sent to you by ${channel} may not arrive. Check the address and send a test.`,
      evidence: {
        window: 'current state',
        facts: [
          { label: 'Status', value: endpoint.status },
          { label: 'Consecutive failures', value: String(endpoint.failureCount) },
        ],
      },
      draftHref: '/settings/profile?tab=notifications',
    });
  }
  for (const service of input.services) {
    if (!lowValue(service, t.minPages)) continue;
    items.push({
      key: `low-value:${service.serviceId}`,
      severity: 'INFO',
      title: 'A service pages you but rarely needs you',
      summary: `You acted on ${service.acted} of ${service.pages} pages from it. Consider moving it to a digest or lowering its urgency.`,
      evidence: {
        window: WINDOW,
        facts: facts(service),
        examples: [
          {
            label: 'Open its notification settings',
            href: serviceNotifications(service.serviceId),
          },
        ],
      },
      draftHref: serviceNotifications(service.serviceId),
    });
  }
  const { night } = input;
  if (
    !input.quietHoursEnabled &&
    night.pages >= t.minPages &&
    share(night.acted, night.pages) <= t.maxActedPercent
  ) {
    const hours = `${t.nightStartHour}:00 to 0${t.nightEndHour}:00`;
    items.push({
      key: 'quiet-hours',
      severity: 'INFO',
      title: 'Night pages you rarely act on',
      summary: `You acted on ${night.acted} of ${night.pages} pages between ${hours}. Quiet hours hold low-urgency pages overnight; high-urgency pages still come through.`,
      evidence: {
        window: WINDOW,
        facts: [
          { label: `Pages between ${hours}`, value: String(night.pages) },
          { label: 'Acted on', value: pct(night.acted, night.pages) },
        ],
      },
      draftHref: '/settings/profile?tab=schedule',
    });
  }
  return items;
}

export function deriveServiceNoise(input: ServiceNoiseInput): OpsInsightItem[] {
  if (!lowValue(input, t.minServicePages)) return [];
  return [
    {
      key: 'low-value',
      severity: 'INFO',
      title: 'Most pages from this service need nobody',
      summary: `People acted on ${input.acted} of ${input.pages} pages it sent. Consider sending it to a digest or at low urgency.`,
      evidence: { window: WINDOW, facts: facts(input) },
      draftHref: serviceNotifications(input.serviceId),
    },
  ];
}

const empty = (): Counts => ({ pages: 0, acted: 0, autoResolved: 0 });
function add(into: Counts, row: Counts) {
  into.pages += row.pages;
  into.acted += row.acted;
  into.autoResolved += row.autoResolved;
}

export const userNoiseProducer: OpsInsightProducer<UserNoiseInput> = {
  kind: 'notification.noise',
  version: 1,
  area: 'notifications',
  scopeType: 'USER',

  // Two reads: the person's rollup rows on idx_metric_rollup_subject, and the person with their endpoints.
  async loadInput(scope, { tx, now }) {
    const user = await tx.user.findUnique({
      where: { id: scope.id },
      select: {
        quietHoursEnabled: true,
        notificationEndpoints: { select: { channel: true, status: true, failureCount: true } },
      },
    });
    if (!user) return null;
    const rows = toNoiseDailyRows(
      await queryOpsRollup(
        OPS_ROLLUPS.pagesPerUserService,
        { ...noiseWindow(now), subjectKey: scope.id, limit: 10_000 },
        tx
      )
    );
    const services = new Map<string, Counts>();
    const night = empty();
    for (const row of rows) {
      const service = services.get(row.serviceId) ?? empty();
      add(service, row);
      services.set(row.serviceId, service);
      if (isNight(row.hour)) add(night, row);
    }
    const endpoints = user.notificationEndpoints
      .filter(endpoint => endpoint.status in ENDPOINT_PROBLEMS)
      .map(endpoint => ({
        ...endpoint,
        channel: String(endpoint.channel),
        status: String(endpoint.status),
      }))
      .sort((a, b) => a.channel.localeCompare(b.channel));
    if (rows.length === 0 && endpoints.length === 0) return null;
    return {
      services: [...services.entries()]
        .map(([serviceId, counts]) => ({ serviceId, ...counts }))
        .filter(service => lowValue(service, t.minPages))
        .sort((a, b) => b.pages - a.pages || a.serviceId.localeCompare(b.serviceId))
        .slice(0, t.maxLowValueSources),
      night,
      quietHoursEnabled: user.quietHoursEnabled,
      endpoints,
    };
  },

  derive: deriveUserNoise,
};

export const serviceNoiseProducer: OpsInsightProducer<ServiceNoiseInput> = {
  kind: 'notification.service_noise',
  version: 1,
  area: 'notifications',
  scopeType: 'SERVICE',

  // One read: the service's rollup rows (at most 2 a day) on idx_metric_rollup_subject.
  async loadInput(scope, { tx, now }) {
    const points = await queryOpsRollup(
      OPS_ROLLUPS.pagesPerService,
      { ...noiseWindow(now), subjectKey: scope.id, limit: 200 },
      tx
    );
    const total = empty();
    for (const point of points) {
      const auto = (point.tags as { autoResolved?: boolean } | null)?.autoResolved === true;
      add(total, { pages: point.count, acted: point.sum, autoResolved: auto ? point.count : 0 });
    }
    return total.pages > 0 ? { serviceId: scope.id, ...total } : null;
  },

  derive: deriveServiceNoise,
};
