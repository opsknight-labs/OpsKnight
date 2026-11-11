import 'server-only';
import { Prisma } from '@prisma/client';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Integration health for one service (plan J7), and the reference producer other slices copy.
 *
 * Three questions, answered from the alerts the service already stored:
 * - silent: it used to send alerts and has sent none for much longer than its own usual gap;
 * - volume-step: the last 24 hours are far above or below the week before;
 * - missing-severity: most recent alerts arrived without a severity, so urgency rules cannot use it.
 *
 * Reads: two statements, every arm on idx_alert_by_service ("serviceId", "createdAt") and capped by LIMIT,
 * so a service with millions of alerts costs the same as a small one.
 */
export interface IntegrationHealthInput {
  serviceId: string;
  /** Whole days since the last alert, capped at SILENT_GIVE_UP_DAYS. */
  silentDays: number;
  silentHours: number;
  /** Alerts in the 7 days up to the last alert: the service's own usual pace. Capped. */
  weekBeforeLastAlert: number;
  last24h: number;
  /** Alerts in the 7 days before the last 24 hours. */
  priorWeek: number;
  /** A count reached its cap, so the comparison would be wrong and is not made. */
  capped: boolean;
  recentSampled: number;
  recentMissingSeverity: number;
}

const COUNT_CAP = 20_000;
const RECENT_SAMPLE = 200;
/** After this long a silent source was most likely retired on purpose; stop reporting it. */
export const SILENT_GIVE_UP_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Row = {
  lastAlertAt: Date | null;
  last24h: number;
  priorWeek: number;
  recentSampled: number;
  recentMissingSeverity: number;
};

export const integrationHealthProducer: OpsInsightProducer<IntegrationHealthInput> = {
  kind: 'integration.health',
  version: 1,
  area: 'automation',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const eightDaysAgo = new Date(now.getTime() - 8 * DAY_MS);
    const [row] = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        (SELECT "createdAt" FROM "Alert" WHERE "serviceId" = ${scope.id}
          ORDER BY "createdAt" DESC LIMIT 1) AS "lastAlertAt",
        (SELECT count(*)::int FROM (SELECT 1 FROM "Alert"
          WHERE "serviceId" = ${scope.id} AND "createdAt" >= ${dayAgo} LIMIT ${COUNT_CAP}) recent) AS "last24h",
        (SELECT count(*)::int FROM (SELECT 1 FROM "Alert"
          WHERE "serviceId" = ${scope.id} AND "createdAt" >= ${eightDaysAgo} AND "createdAt" < ${dayAgo}
          LIMIT ${COUNT_CAP}) prior) AS "priorWeek",
        (SELECT count(*)::int FROM (SELECT 1 FROM "Alert" WHERE "serviceId" = ${scope.id}
          ORDER BY "createdAt" DESC LIMIT ${RECENT_SAMPLE}) sampled) AS "recentSampled",
        (SELECT count(*)::int FROM (SELECT "severity" FROM "Alert" WHERE "serviceId" = ${scope.id}
          ORDER BY "createdAt" DESC LIMIT ${RECENT_SAMPLE}) sampled
          WHERE "severity" IS NULL) AS "recentMissingSeverity"`);
    // A service that never received an alert has no integration behaviour to judge yet.
    if (!row?.lastAlertAt) return null;

    const weekBefore = new Date(row.lastAlertAt.getTime() - 7 * DAY_MS);
    const [{ count: weekBeforeLastAlert }] = await tx.$queryRaw<
      Array<{ count: number }>
    >(Prisma.sql`
      SELECT count(*)::int AS count FROM (SELECT 1 FROM "Alert"
        WHERE "serviceId" = ${scope.id} AND "createdAt" >= ${weekBefore} AND "createdAt" <= ${row.lastAlertAt}
        LIMIT ${COUNT_CAP}) usual`);

    const silentHours = Math.max(
      0,
      Math.floor((now.getTime() - row.lastAlertAt.getTime()) / HOUR_MS)
    );
    const silentDays = Math.min(SILENT_GIVE_UP_DAYS, Math.floor(silentHours / 24));
    return {
      serviceId: scope.id,
      silentDays,
      // Hours only matter in the first days; coarser afterwards so an unchanged service is skipped.
      silentHours: silentDays < 3 ? silentHours : silentDays * 24,
      weekBeforeLastAlert,
      last24h: row.last24h,
      priorWeek: row.priorWeek,
      capped: row.last24h >= COUNT_CAP || row.priorWeek >= COUNT_CAP,
      recentSampled: row.recentSampled,
      recentMissingSeverity: row.recentMissingSeverity,
    };
  },

  derive(input) {
    const items: OpsInsightItem[] = [];
    const integrationsHref = `/services/${input.serviceId}/integrations`;
    const perDay = (count: number) => (Math.round((count / 7) * 10) / 10).toString();

    // Silent: at least one alert a day before, and now quiet for three of its usual gaps (a day at least).
    if (input.weekBeforeLastAlert >= 7) {
      const usualGapHours = 168 / input.weekBeforeLastAlert;
      const quietFor = input.silentHours;
      if (quietFor >= Math.max(24, usualGapHours * 3) && input.silentDays < SILENT_GIVE_UP_DAYS) {
        const days = Math.floor(quietFor / 24);
        const duration = days >= 2 ? `${days} days` : `${quietFor} hours`;
        items.push({
          key: 'silent',
          severity: 'WARNING',
          title: `No alerts for ${duration}`,
          summary: `This service used to send about ${perDay(input.weekBeforeLastAlert)} alerts a day and has sent none for ${duration}. Check that its integrations are still connected.`,
          evidence: {
            window: 'the 7 days before the last alert',
            facts: [
              { label: 'Time since the last alert', value: duration },
              { label: 'Usual alerts per day', value: perDay(input.weekBeforeLastAlert) },
            ],
          },
          draftHref: integrationsHref,
        });
      }
    }

    // Volume step: only judged against a real baseline, and never when a count hit its cap.
    if (!input.capped && input.priorWeek >= 35) {
      const usual = input.priorWeek / 7;
      const facts = [
        { label: 'Alerts in the last 24 hours', value: String(input.last24h) },
        { label: 'Usual alerts per day', value: perDay(input.priorWeek) },
      ];
      if (input.last24h >= 50 && input.last24h >= usual * 3) {
        items.push({
          key: 'volume-step',
          severity: 'WARNING',
          title: `Alert volume is ${Math.round(input.last24h / usual)} times the usual`,
          summary: `${input.last24h} alerts arrived in the last 24 hours against about ${perDay(input.priorWeek)} a day in the week before. A source may have changed what it sends.`,
          evidence: { window: 'last 24 hours against the 7 days before', facts },
          draftHref: integrationsHref,
        });
      } else if (input.priorWeek >= 140 && input.last24h > 0 && input.last24h <= usual / 4) {
        items.push({
          key: 'volume-step',
          severity: 'INFO',
          title: 'Alert volume dropped sharply',
          summary: `${input.last24h} alerts arrived in the last 24 hours against about ${perDay(input.priorWeek)} a day in the week before. Part of a source may have stopped sending.`,
          evidence: { window: 'last 24 hours against the 7 days before', facts },
          draftHref: integrationsHref,
        });
      }
    }

    if (input.recentSampled >= 20 && input.recentMissingSeverity / input.recentSampled >= 0.5) {
      const share = Math.round((input.recentMissingSeverity / input.recentSampled) * 100);
      items.push({
        key: 'missing-severity',
        severity: share >= 90 ? 'WARNING' : 'INFO',
        title: `${share}% of recent alerts have no severity`,
        summary: `${input.recentMissingSeverity} of the last ${input.recentSampled} alerts arrived without a severity, so urgency and routing rules cannot use it. Map a severity field in the integration.`,
        evidence: {
          window: `last ${input.recentSampled} alerts`,
          facts: [
            { label: 'Alerts checked', value: String(input.recentSampled) },
            { label: 'Without a severity', value: String(input.recentMissingSeverity) },
          ],
        },
        draftHref: integrationsHref,
      });
    }
    return items;
  },
};
