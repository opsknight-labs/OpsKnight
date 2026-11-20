import 'server-only';

import { formatMetric } from '@/components/analytics/format';
import { AnalyticsWeeklyEmail } from '@/emails/templates/analytics-weekly';
import { renderEmail } from '@/emails/render';
import { resolveUserActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import prisma from '@/lib/prisma';
import {
  createAnalyticsContext,
  getAnalyticsSection,
  parseAnalyticsParams,
  type AnalyticsParams,
} from './index';
import type { AggregateMetrics } from './sql';

const DAY_MS = 86_400_000;
const TOP_SERVICES = 3;

/** Monday 00:00 UTC of the week containing `now`. */
export function analyticsReportWeekStart(now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

/** The view's filters over the last 7 days, compared with the 7 before. */
export function weeklyReportParams(query: string): AnalyticsParams {
  return {
    ...parseAnalyticsParams(new URLSearchParams(query)),
    range: '7d',
    from: undefined,
    to: undefined,
    compare: true,
  };
}

const KPI_ROWS: Array<{ label: string; key: keyof AggregateMetrics; unit: 'count' | 'duration' | 'percent' }> = [
  { label: 'Incidents', key: 'incidents', unit: 'count' },
  { label: 'MTTA (median)', key: 'mttaP50', unit: 'duration' },
  { label: 'MTTR (median)', key: 'mttrP50', unit: 'duration' },
  { label: 'Ack SLA met', key: 'ackSla', unit: 'percent' },
  { label: 'Resolve SLA met', key: 'resolveSla', unit: 'percent' },
];

/**
 * Sends each subscribed view's weekly KPI summary once per week (Monday 00:00
 * UTC onward). Numbers come only from getAnalyticsSection with the recipient as
 * actor, so they match the page and respect the recipient's access. The
 * notification event key is per view and week, so a crash between enqueue and
 * the lastSentAt write never sends twice.
 */
export async function sendWeeklyAnalyticsReports(now = new Date(), limit = 25) {
  const weekStart = analyticsReportWeekStart(now);
  const weekKey = weekStart.toISOString().slice(0, 10);
  const result = { sent: 0, skipped: 0, failed: 0 };
  const views = await prisma.analyticsView.findMany({
    where: { emailWeekly: true, OR: [{ lastSentAt: null }, { lastSentAt: { lt: weekStart } }] },
    select: {
      id: true,
      name: true,
      query: true,
      userId: true,
      user: {
        select: {
          name: true,
          email: true,
          status: true,
          timeZone: true,
          emailNotificationsEnabled: true,
        },
      },
    },
    orderBy: [{ lastSentAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: limit,
  });

  for (const view of views) {
    const markSent = () =>
      prisma.analyticsView.update({ where: { id: view.id }, data: { lastSentAt: now } });
    try {
      const { user } = view;
      const actor =
        user.status === 'ACTIVE' && user.emailNotificationsEnabled && user.email
          ? await resolveUserActor(view.userId)
          : null;
      if (!actor || !authorize({ actor, action: AUTHORIZATION_ACTIONS.REPORT_READ }).allowed) {
        // Skipped for this week, so the row does not crowd out others every tick.
        await markSent();
        result.skipped++;
        continue;
      }

      const params = weeklyReportParams(view.query);
      const context = await createAnalyticsContext(actor, params, user.timeZone);
      const [kpis, services] = await Promise.all([
        getAnalyticsSection(context, 'kpis'),
        getAnalyticsSection(context, 'services'),
      ]);
      const query = new URLSearchParams(view.query);
      query.set('range', '7d');
      query.delete('from');
      query.delete('to');
      const viewUrl = `${getBaseUrl()}/analytics?${query.toString()}`;
      const day = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: context.window.timeZone,
      });
      const { html, text } = await renderEmail(
        AnalyticsWeeklyEmail({
          userName: user.name || 'there',
          viewName: view.name,
          viewUrl,
          periodLabel: `${day.format(context.window.start)} – ${day.format(context.window.end)} (${context.window.timeZone})`,
          kpis: KPI_ROWS.map((row, index) => ({
            label: row.label,
            value: `${formatMetric(kpis.current[row.key], row.unit)} (was ${formatMetric(kpis.previous[row.key], row.unit)})`,
            highlight: index === 0,
          })),
          topServices: services.slice(0, TOP_SERVICES).map(service => ({
            label: service.name,
            value: `${service.incidents} incidents (was ${service.previousIncidents})`,
          })),
        })
      );

      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientId: view.userId,
        recipientAddress: user.email,
        userId: view.userId,
        templateKey: 'analytics-weekly-report',
        sourceType: 'ANALYTICS_VIEW',
        sourceId: view.id,
        eventKey: `${view.id}:${weekKey}`,
        displayMessage: `Weekly analytics report for ${view.name}`,
        trafficClass: 'BULK',
        payload: {
          kind: 'EMAIL',
          to: user.email,
          subject: `Weekly analytics: ${view.name}`,
          html,
          text,
        },
      });
      await markSent();
      result.sent++;
    } catch (error) {
      // shortcut: left unmarked and retried every tick; add a failure count/backoff if
      // persistently failing views ever crowd out the per-tick limit.
      result.failed++;
      logger.warn('[Analytics] Weekly report failed', { viewId: view.id, error });
    }
  }
  return result;
}
