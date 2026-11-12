import 'server-only';
import type { ServerEvent, ServerEventBus } from '@modelcontextprotocol/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ASSIGNED_NOTIFICATION_TITLE, PAGE_NOTIFICATION_TITLE } from '@/lib/user-notifications';
import { CostBudget } from '../core/budget';
import { callMcpOperation, type ExecutionContext } from '../core/execution';

/** Collection URI: incidents that newly page the subscribing person. "me" is the stream's actor. */
export const MY_PAGES_URI = 'opsknight://oncall/me/pages';
/** Where each page hint carries its minimal fields; fetch details with incident_get. */
export const PAGE_META_KEY = 'com.opsknight/page';

/**
 * The in-app records notification and escalation write for every responder they page or assign
 * (escalation/notification-intents.ts and user-notifications.ts). Reading them reuses those
 * decisions instead of re-deriving who was paged.
 */
const PAGE_TITLES = [PAGE_NOTIFICATION_TITLE, ASSIGNED_NOTIFICATION_TITLE];
// shortcut: a page whose transaction commits more than this after its createdAt is missed; widen if seen.
const LOOKBACK_MS = 60_000;
const PAGE_ROW_LIMIT = 200;

type Page = {
  at: number;
  incident: {
    id: string;
    title: string;
    urgency: string | null;
    priority: string | null;
    serviceId: string;
  };
};
const watchers = new Map<string, Set<(page: Page) => void>>();
const seen = new Map<string, number>();

/** One query per poll tick for every watching person on this replica. Called by pollChanges. */
export async function pollPages(now = Date.now()) {
  if (!watchers.size) return;
  const since = now - LOOKBACK_MS;
  const rows = await prisma.inAppNotification.findMany({
    where: {
      userId: { in: [...watchers.keys()] },
      type: 'INCIDENT',
      entityType: 'INCIDENT',
      title: { in: PAGE_TITLES },
      createdAt: { gte: new Date(since) },
    },
    select: { id: true, userId: true, entityId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: PAGE_ROW_LIMIT,
  });
  for (const [id, at] of seen) if (at < since) seen.delete(id);
  const fresh = rows.filter(row => row.entityId && !seen.has(row.id));
  for (const row of fresh) seen.set(row.id, row.createdAt.getTime());
  if (!fresh.length) return;
  const incidents = new Map(
    (
      await prisma.incident.findMany({
        where: { id: { in: [...new Set(fresh.map(row => row.entityId!))] } },
        select: { id: true, title: true, urgency: true, priority: true, serviceId: true },
      })
    ).map(incident => [incident.id, incident])
  );
  for (const row of fresh) {
    const incident = incidents.get(row.entityId!);
    if (!incident) continue;
    for (const deliver of watchers.get(row.userId) ?? [])
      deliver({ at: row.createdAt.getTime(), incident });
  }
}

/**
 * The bus for one listen stream that subscribed to MY_PAGES_URI: every shared event, plus this
 * person's own pages. Each page is re-authorized with the stream's fresh authority (getIncident)
 * before it is sent, so a hidden-team incident or a revoked grant never produces a hint.
 */
export function myPagesBus(
  base: ServerEventBus,
  context: ExecutionContext,
  userId: string
): ServerEventBus {
  return {
    publish: event => base.publish(event),
    subscribe(listener) {
      const offBase = base.subscribe(listener);
      const startedAt = Date.now();
      let active = true;
      const deliver = (page: Page) => {
        if (page.at < startedAt) return;
        const budget = new CostBudget(1, 262144);
        void callMcpOperation({ ...context, budget }, 'getIncident', {
          path: { id: page.incident.id },
        })
          .then(() => {
            if (!active) return;
            const { id, title, urgency, priority, serviceId } = page.incident;
            const event: ServerEvent = {
              kind: 'resource_updated',
              uri: MY_PAGES_URI,
              // Ids and the fields to fetch details; never notes or alert payloads. Title is untrusted.
              params: {
                _meta: { [PAGE_META_KEY]: { incidentId: id, title, urgency, priority, serviceId } },
              },
            };
            listener(event);
          })
          .catch(() =>
            logger.info('mcp.subscription.page_withheld', { incidentId: page.incident.id })
          )
          .finally(() => void budget.drain());
      };
      const own = watchers.get(userId) ?? new Set();
      own.add(deliver);
      watchers.set(userId, own);
      return () => {
        active = false;
        offBase();
        own.delete(deliver);
        if (!own.size) watchers.delete(userId);
      };
    },
  };
}

/** Test seam. */
export function resetPagePushForTests() {
  watchers.clear();
  seen.clear();
}
