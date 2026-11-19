import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { computeLoad } from '@/lib/oncall-load/metrics';
import { loadPageBuckets, loadWindow, LOAD_WINDOW_DAYS } from '@/lib/oncall-load/store';
import type { OpsInsightView } from '../ops-insights/contract';
import { listInsightsForScope, readableOpsInsightScopes } from '../ops-insights/view';
import { EXPERT_WINDOW_DAYS } from '../triage/experts';
import { peopleSuggestionsEnabled } from './enabled';

export interface PersonProfileInsights {
  load: { pages: number; nightPages: number; nightsPaged: number; windowDays: number };
  /** Open oncall.person insights (load above the rotation, sustained night pages, risky next shift). */
  insights: OpsInsightView[];
  /** Services where this person resolved incidents in the last 180 days, most first. */
  expertise: Array<{ serviceId: string; serviceName: string; resolved: number }>;
  expertiseDays: number;
}

const MAX_SERVICES = 5;

/**
 * The load and expertise card on a person's profile. Only for that person, a lead of one of their teams,
 * or an administrator (the USER insight rule); null otherwise, while "Suggest people" is off, or when there
 * is nothing to show. Expertise counts only incidents the viewer may read. Read on page view only.
 */
export async function loadPersonProfileInsights(
  actor: AuthorizationActor,
  userId: string,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<PersonProfileInsights | null> {
  if (!(await peopleSuggestionsEnabled(client))) return null;
  if (!(await readableOpsInsightScopes(actor, 'USER', [userId], client)).has(userId)) return null;

  const window = loadWindow(now);
  const since = new Date(now.getTime() - EXPERT_WINDOW_DAYS * 86_400_000);
  const [user, buckets, insights, resolved] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
    loadPageBuckets([userId], window, client),
    listInsightsForScope(actor, { type: 'USER', id: userId }, { client }),
    // The (assigneeId, status) index bounds this to one person's resolved incidents.
    client.incident.groupBy({
      by: ['serviceId'],
      where: {
        AND: [
          { assigneeId: userId, status: 'RESOLVED', resolvedAt: { gte: since } },
          incidentReadWhere(actor),
        ],
      },
      _count: { _all: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: MAX_SERVICES,
    }),
  ]);
  const names = await readableOpsInsightScopes(
    actor,
    'SERVICE',
    resolved.map(row => row.serviceId),
    client
  );
  const person = computeLoad({
    buckets,
    users: [{ userId, timeZone: user?.timeZone }],
    onCallSeconds: new Map(),
    from: window.from,
    to: window.to,
  }).people[0];
  const card: PersonProfileInsights = {
    load: {
      pages: person?.pages ?? 0,
      nightPages: person?.nightPages ?? 0,
      nightsPaged: person?.nightsPaged ?? 0,
      windowDays: LOAD_WINDOW_DAYS,
    },
    insights: insights.filter(insight => insight.kind === 'oncall.person'),
    expertise: resolved
      .filter(row => names.has(row.serviceId))
      .map(row => ({
        serviceId: row.serviceId,
        serviceName: names.get(row.serviceId)!,
        resolved: row._count._all,
      }))
      .sort((a, b) => b.resolved - a.resolved || a.serviceName.localeCompare(b.serviceName)),
    expertiseDays: EXPERT_WINDOW_DAYS,
  };
  const empty = card.load.pages === 0 && card.insights.length === 0 && card.expertise.length === 0;
  return empty ? null : card;
}
