import 'server-only';

import { describeDelta, formatMetric } from '@/components/analytics/format';
import {
  AnalyticsWeeklyEmail,
  type AnalyticsWeeklyEmailProps,
  type WeeklyDelta,
} from '@/emails/templates/analytics-weekly';
import { renderEmail } from '@/emails/render';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import prisma from '@/lib/prisma';
import { normalizeContractTimeZone } from '@/lib/time-retention-contract';
import { addDaysToDateKey, formatDateKeyInTimeZone } from '@/lib/timezone';
import {
  createAnalyticsContext,
  getAnalyticsSection,
  METRICS,
  parseAnalyticsParams,
  percentChange,
  toAnalyticsSearchParams,
  type AnalyticsParams,
  type AnalyticsSectionData,
  type MetricId,
} from './index';

const DAY_MS = 86_400_000;
const TOP_ROWS = 5;
const MAX_HIGHLIGHTS = 4;
/** A change has to be at least this big to be called out. */
const NOTABLE_PERCENT = 20;
const NOTABLE_POINTS = 5;

// Map lookup: typed ids in, definitions out (no dynamic property access).
const DEFINITIONS = new Map(Object.entries(METRICS)) as Map<MetricId, (typeof METRICS)[MetricId]>;
const definition = (id: MetricId) => DEFINITIONS.get(id)!;

/** Monday 00:00 UTC of the week containing `now`: the once-per-week send boundary. */
export function analyticsReportWeekStart(now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

/**
 * The view's filters over last week, Monday to Sunday in the recipient's timezone,
 * compared with the week before. Calendar weeks (not a rolling 7 days) give seven
 * whole days for the daily chart and a period people recognise.
 */
export function weeklyReportParams(query: string, now: Date, timeZone: string): AnalyticsParams {
  const zone = normalizeContractTimeZone(timeZone);
  const today = formatDateKeyInTimeZone(now, zone);
  const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const from = addDaysToDateKey(today, -weekday - 7);
  const to = addDaysToDateKey(from, 6);
  const week = parseAnalyticsParams({ from, to });
  return {
    ...parseAnalyticsParams(new URLSearchParams(query)),
    range: 'custom',
    from: week.from,
    to: week.to,
    compare: true,
  };
}

type Sections = {
  kpis: AnalyticsSectionData<'kpis'>;
  services: AnalyticsSectionData<'services'>;
  trend: AnalyticsSectionData<'trend'>;
  responders: AnalyticsSectionData<'responders'>;
  noise: AnalyticsSectionData<'noise'>;
  followThrough: AnalyticsSectionData<'followThrough'>;
};

function delta(current: number | null, previous: number | null, id: MetricId): WeeklyDelta | null {
  const metric = definition(id);
  const described = describeDelta(current, previous, metric.unit, metric.better);
  if (!described) return null;
  if (described.direction === 'flat')
    return { text: 'no change', direction: 'flat', tone: 'neutral' };
  return {
    text: described.label.replace(/^[+−-]/, ''),
    direction: described.direction,
    tone: described.tone,
  };
}

const dayLabel = (bucket: string) =>
  new Date(`${bucket.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });

/** What got worse, phrased for a busy reader; empty when nothing is notable. */
export function weeklyHighlights({ kpis, services, followThrough }: Sections): string[] {
  const { current: now, previous: before } = kpis;
  const lines: string[] = [];
  const worse = (id: MetricId, cur: number | null, prev: number | null) => {
    const change = percentChange(cur, prev);
    const metric = definition(id);
    if (change === null || Math.abs(change) < NOTABLE_PERCENT) return;
    if ((metric.better === 'down' && change > 0) || (metric.better === 'up' && change < 0)) {
      lines.push(
        `${metric.label.replace(' (median)', '')} ${change > 0 ? 'rose' : 'fell'} to ${formatMetric(cur, metric.unit)} from ${formatMetric(prev, metric.unit)} (${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%).`
      );
    }
  };
  worse('incidents', now.incidents, before.incidents);
  worse('mttrP50', now.mttrP50, before.mttrP50);
  worse('mttaP50', now.mttaP50, before.mttaP50);
  const slaDrops: Array<[MetricId, number | null, number | null]> = [
    ['ackSla', now.ackSla, before.ackSla],
    ['resolveSla', now.resolveSla, before.resolveSla],
  ];
  for (const [id, cur, prev] of slaDrops) {
    if (cur !== null && prev !== null && prev - cur >= NOTABLE_POINTS) {
      lines.push(
        `${definition(id).label} fell to ${formatMetric(cur, 'percent')} from ${formatMetric(prev, 'percent')}.`
      );
    }
  }
  const riser = [...services]
    .filter(service => service.incidents >= 2 && service.incidents > service.previousIncidents)
    .sort((a, b) => b.incidents - b.previousIncidents - (a.incidents - a.previousIncidents))[0];
  if (riser)
    lines.push(
      `${riser.name} had ${riser.incidents} incidents, up from ${riser.previousIncidents}.`
    );
  if (followThrough.actionItemsOverdue > 0) {
    const n = followThrough.actionItemsOverdue;
    lines.push(`${n} postmortem action item${n === 1 ? ' is' : 's are'} overdue.`);
  }
  if ((now.afterHoursRate ?? 0) >= 40 && now.incidents >= 5) {
    lines.push(
      `${formatMetric(now.afterHoursRate, 'percent')} of incidents arrived outside business hours.`
    );
  }
  return lines.slice(0, MAX_HIGHLIGHTS);
}

/** Pure: turns the section data into the email's props. Numbers are formatted once, here. */
export function buildWeeklyReportProps(input: {
  userName: string;
  viewName: string;
  viewUrl: string;
  periodLabel: string;
  timeZone: string;
  sections: Sections;
}): AnalyticsWeeklyEmailProps {
  const { kpis, services, trend, responders, noise, followThrough } = input.sections;
  const { current, previous } = kpis;
  const kpi = (id: MetricId, value: number | null, prev: number | null, hint?: string) => ({
    label: definition(id).label,
    value: formatMetric(value, definition(id).unit),
    delta: delta(value, prev, id),
    hint,
  });
  const highlights = weeklyHighlights(input.sections);
  const attention = highlights.length > 0;
  return {
    userName: input.userName,
    viewName: input.viewName,
    viewUrl: input.viewUrl,
    periodLabel: input.periodLabel,
    timeZone: input.timeZone,
    attention,
    highlights: attention
      ? highlights
      : [
          current.incidents === 0
            ? 'No incidents matched this view last week.'
            : 'Nothing got notably worse compared with the week before.',
        ],
    kpis: [
      kpi('incidents', current.incidents, previous.incidents),
      kpi(
        'mttaP50',
        current.mttaP50,
        previous.mttaP50,
        current.mttaP90 === null ? undefined : `p90 ${formatMetric(current.mttaP90, 'duration')}`
      ),
      kpi(
        'mttrP50',
        current.mttrP50,
        previous.mttrP50,
        current.mttrP90 === null ? undefined : `p90 ${formatMetric(current.mttrP90, 'duration')}`
      ),
      kpi('ackSla', current.ackSla, previous.ackSla),
      kpi('resolveSla', current.resolveSla, previous.resolveSla),
      kpi('afterHoursRate', current.afterHoursRate, previous.afterHoursRate),
    ],
    days: trend.map(point => ({
      label: dayLabel(point.bucket),
      count: point.high + point.medium + point.low,
    })),
    services: services.slice(0, TOP_ROWS).map(service => ({
      name: service.name,
      incidents: String(service.incidents),
      delta: delta(service.incidents, service.previousIncidents, 'incidents'),
      mttr: formatMetric(service.mttrP50, 'duration'),
      sla: formatMetric(service.resolveSla, 'percent'),
    })),
    responders: responders
      .filter(person => person.incidents > 0)
      .slice(0, TOP_ROWS)
      .map(person => ({
        name: person.name,
        incidents: String(person.incidents),
        offHours: String(person.evening + person.overnight),
        hours: `${(person.handlingHours ?? 0).toFixed(1)}h`,
      })),
    health: [
      { label: 'Alerts per incident', value: formatMetric(noise.alertsPerIncident, 'ratio') },
      { label: 'Auto-resolved', value: formatMetric(noise.autoResolvedRate, 'percent') },
      {
        label: 'Postmortems published',
        value: followThrough.highResolved
          ? `${followThrough.postmortemsPublished} of ${followThrough.highResolved} resolved high-urgency incidents`
          : 'No resolved high-urgency incidents',
      },
      { label: 'Open action items', value: String(followThrough.actionItemsOpen) },
      {
        label: 'Overdue action items',
        value: String(followThrough.actionItemsOverdue),
        highlight: followThrough.actionItemsOverdue > 0,
      },
    ],
  };
}

/**
 * The one way to produce a weekly email: section data for `query` over last calendar week,
 * read as `actor` (their access, their numbers), rendered with the shared template.
 * `empty` is true when there is nothing to report (no incidents this or last week, none open).
 */
export async function composeWeeklyEmail(input: {
  actor: AuthorizationActor;
  userName: string;
  timeZone: string | null | undefined;
  query: string;
  name: string;
  now: Date;
  kind: 'view' | 'digest';
  manageUrl?: string;
}): Promise<{ html: string; text: string; incidents: number; empty: boolean }> {
  const timeZone = normalizeContractTimeZone(input.timeZone);
  const params = weeklyReportParams(input.query, input.now, timeZone);
  const context = await createAnalyticsContext(input.actor, params, timeZone);
  const [kpis, services, trend, responders, noise, followThrough] = await Promise.all([
    getAnalyticsSection(context, 'kpis'),
    getAnalyticsSection(context, 'services'),
    getAnalyticsSection(context, 'trend'),
    getAnalyticsSection(context, 'responders'),
    getAnalyticsSection(context, 'noise'),
    getAnalyticsSection(context, 'followThrough'),
  ]);
  // Calendar-day keys at UTC midnight: format in UTC so the dates don't shift.
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const lastDay = new Date(params.to!.getTime() - DAY_MS);
  const periodLabel = `${day.format(params.from!)} – ${day.format(lastDay)}, ${lastDay.getUTCFullYear()}`;
  const viewUrl = `${getBaseUrl()}/insights?${toAnalyticsSearchParams(params).toString()}`;
  const { html, text } = await renderEmail(
    AnalyticsWeeklyEmail({
      ...buildWeeklyReportProps({
        userName: input.userName,
        viewName: input.name,
        viewUrl,
        periodLabel,
        timeZone,
        sections: { kpis, services, trend, responders, noise, followThrough },
      }),
      kind: input.kind,
      manageUrl: input.manageUrl,
    })
  );
  return {
    html,
    text,
    incidents: kpis.current.incidents,
    empty: kpis.current.incidents === 0 && kpis.previous.incidents === 0 && kpis.openNow === 0,
  };
}

/**
 * Sends each subscribed view's weekly report once per week (Monday 00:00 UTC
 * onward). Numbers come only from getAnalyticsSection with the recipient as
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

      const email = await composeWeeklyEmail({
        actor,
        userName: user.name || 'there',
        timeZone: user.timeZone,
        query: view.query,
        name: view.name,
        now,
        kind: 'view',
      });
      const { html, text } = email;

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
          subject: `Weekly analytics: ${view.name} · ${email.incidents} incidents last week`,
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
