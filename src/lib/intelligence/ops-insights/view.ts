import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  runbookReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { getIntelligenceSettings } from '../settings/service';
import {
  enabledOpsInsightAreas,
  opsInsightEvidenceSchema,
  type OpsInsightCount,
  type OpsInsightInboxItem,
  type OpsInsightScope,
  type OpsInsightScopeType,
  type OpsInsightSeverity,
  type OpsInsightView,
} from './contract';

type Client = Prisma.TransactionClient | typeof prisma;

export const OPS_INSIGHT_READ_LIMITS = {
  scopeList: 20,
  scopeListMax: 50,
  /** Ids one badge query accepts: a list page's rows. */
  countScopes: 200,
  inbox: 20,
  inboxMax: 50,
  /** Rows read per round while filtering the inbox to what the viewer may see. */
  inboxPage: 100,
  inboxRounds: 5,
} as const;

const VIEW_SELECT = {
  id: true,
  scopeType: true,
  scopeId: true,
  kind: true,
  key: true,
  area: true,
  severity: true,
  status: true,
  title: true,
  summary: true,
  evidence: true,
  draftHref: true,
  firstSeenAt: true,
  lastSeenAt: true,
} satisfies Prisma.OpsInsightSelect;

type Row = Prisma.OpsInsightGetPayload<{ select: typeof VIEW_SELECT }>;

function toView(row: Row): OpsInsightView {
  const evidence = opsInsightEvidenceSchema.safeParse(row.evidence);
  return { ...row, evidence: evidence.success ? evidence.data : { facts: [] } };
}

const SCOPE_PATHS: Record<OpsInsightScopeType, string> = {
  SERVICE: '/services',
  POLICY: '/policies',
  SCHEDULE: '/schedules',
  RUNBOOK: '/runbooks',
  USER: '/users',
  TEAM: '/teams',
};

/** Areas a reader is shown: none while operations insights are off. */
async function visibleAreas(client: Client): Promise<string[]> {
  return enabledOpsInsightAreas(await getIntelligenceSettings(client));
}

/**
 * The scopes of one type, out of `ids`, that the actor may read, with their names. One primary-key query
 * through the product's own read filters; an actor who may not read the type at all gets nothing.
 *
 * A person's insights (scope USER) are visible to that person, to an owner of a team they belong to, and to
 * administrators. Nobody else, whatever else they can read.
 */
export async function readableOpsInsightScopes(
  actor: AuthorizationActor,
  type: OpsInsightScopeType,
  ids: readonly string[],
  client: Client = prisma
): Promise<Map<string, string>> {
  if (ids.length === 0 || actor.status !== 'ACTIVE') return new Map();
  const id = { in: [...new Set(ids)] };
  const select = { id: true, name: true } as const;
  let rows: Array<{ id: string; name: string | null }>;
  try {
    switch (type) {
      case 'SERVICE':
        rows = await client.service.findMany({
          where: { AND: [{ id }, serviceReadWhere(actor)] },
          select,
        });
        break;
      case 'SCHEDULE':
        rows = await client.onCallSchedule.findMany({
          where: { AND: [{ id }, scheduleReadWhere(actor)] },
          select,
        });
        break;
      case 'RUNBOOK':
        rows = await client.runbook.findMany({
          where: { AND: [{ id }, runbookReadWhere(actor)] },
          select,
        });
        break;
      case 'TEAM':
        rows = await client.team.findMany({
          where: { AND: [{ id }, teamReadWhere(actor)] },
          select,
        });
        break;
      case 'POLICY':
        if (!authorize({ actor, action: AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ }).allowed)
          return new Map();
        rows = await client.escalationPolicy.findMany({ where: { id }, select });
        break;
      case 'USER':
        rows = await client.user.findMany({
          where: hasCapability(actor.role, CAPABILITIES.ADMIN_MANAGE)
            ? { id }
            : {
                AND: [
                  { id },
                  {
                    OR: [
                      { id: actor.id },
                      {
                        teamMemberships: {
                          some: {
                            team: { members: { some: { userId: actor.id, role: 'OWNER' } } },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
          select,
        });
        break;
    }
  } catch (error) {
    // The read filters throw when the actor may not read the type at all: that is "nothing", not a failure.
    if (error instanceof Error && error.name === 'AuthorizationError') return new Map();
    throw error;
  }
  return new Map(rows.map(row => [row.id, row.name ?? '']));
}

/**
 * Insights on one scope, most severe first. Empty when the viewer may not read the scope or the area is off.
 * Open insights by default; `includeDecided` adds accepted and dismissed ones for a "show all" view.
 */
export async function listInsightsForScope(
  actor: AuthorizationActor,
  scope: OpsInsightScope,
  options: { limit?: number; includeDecided?: boolean; client?: Client } = {}
): Promise<OpsInsightView[]> {
  const client = options.client ?? prisma;
  const areas = await visibleAreas(client);
  if (areas.length === 0) return [];
  if (!(await readableOpsInsightScopes(actor, scope.type, [scope.id], client)).has(scope.id))
    return [];
  const rows = await client.opsInsight.findMany({
    where: {
      scopeType: scope.type,
      scopeId: scope.id,
      area: { in: areas },
      status: { in: options.includeDecided ? ['OPEN', 'ACCEPTED', 'DISMISSED'] : ['OPEN'] },
    },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }, { id: 'desc' }],
    take: Math.min(
      options.limit ?? OPS_INSIGHT_READ_LIMITS.scopeList,
      OPS_INSIGHT_READ_LIMITS.scopeListMax
    ),
    select: VIEW_SELECT,
  });
  return rows.map(toView);
}

/**
 * Open-insight counts and highest severity for a list page's rows, for InsightBadge: one grouped query on
 * the unique (scopeType, scopeId, kind, key) index, plus one primary-key visibility query. Scopes without an
 * open insight are absent from the map. At most 200 ids are considered.
 */
export async function countOpenInsightsForScopes(
  actor: AuthorizationActor,
  type: OpsInsightScopeType,
  ids: readonly string[],
  client: Client = prisma
): Promise<Map<string, OpsInsightCount>> {
  const wanted = [...new Set(ids)].slice(0, OPS_INSIGHT_READ_LIMITS.countScopes);
  if (wanted.length === 0) return new Map();
  const areas = await visibleAreas(client);
  if (areas.length === 0) return new Map();
  const readable = await readableOpsInsightScopes(actor, type, wanted, client);
  if (readable.size === 0) return new Map();
  const groups = await client.opsInsight.groupBy({
    by: ['scopeId', 'severity'],
    where: {
      scopeType: type,
      scopeId: { in: [...readable.keys()] },
      status: 'OPEN',
      area: { in: areas },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, OpsInsightCount>();
  const rank: Record<OpsInsightSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
  for (const group of groups) {
    const current = counts.get(group.scopeId);
    counts.set(group.scopeId, {
      open: (current?.open ?? 0) + group._count._all,
      highest:
        current && rank[current.highest] >= rank[group.severity] ? current.highest : group.severity,
    });
  }
  return counts;
}

export interface OpsInsightInbox {
  items: OpsInsightInboxItem[];
  /** Pass back as `cursor` for the next page; null when there is no more. */
  nextCursor: string | null;
}

/**
 * The cross-area inbox: open insights the viewer may see, most severe and most recent first, keyset-paged on
 * idx_ops_insight_inbox.
 *
 * shortcut: visibility is applied after reading, in at most 5 rounds of 100 rows with one visibility query
 * per scope type per round, so a viewer who can read very little of a very large estate may see a short
 * page with a cursor. Upgrade to a team column on OpsInsight if that shows up in practice.
 */
export async function listInsightsInbox(
  actor: AuthorizationActor,
  options: { limit?: number; cursor?: string | null; client?: Client } = {}
): Promise<OpsInsightInbox> {
  const client = options.client ?? prisma;
  const limit = Math.min(
    options.limit ?? OPS_INSIGHT_READ_LIMITS.inbox,
    OPS_INSIGHT_READ_LIMITS.inboxMax
  );
  const areas = await visibleAreas(client);
  if (areas.length === 0) return { items: [], nextCursor: null };

  const items: OpsInsightInboxItem[] = [];
  let cursor = options.cursor ?? null;
  for (let round = 0; round < OPS_INSIGHT_READ_LIMITS.inboxRounds; round += 1) {
    const page = await client.opsInsight.findMany({
      where: { status: 'OPEN', area: { in: areas } },
      orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }, { id: 'desc' }],
      take: OPS_INSIGHT_READ_LIMITS.inboxPage,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: VIEW_SELECT,
    });
    if (page.length === 0) return { items, nextCursor: null };

    const byType = new Map<OpsInsightScopeType, string[]>();
    for (const row of page)
      byType.set(row.scopeType, [...(byType.get(row.scopeType) ?? []), row.scopeId]);
    const names = new Map<OpsInsightScopeType, Map<string, string>>();
    for (const [type, ids] of byType)
      names.set(type, await readableOpsInsightScopes(actor, type, ids, client));

    for (const row of page) {
      cursor = row.id;
      const name = names.get(row.scopeType)?.get(row.scopeId);
      if (name === undefined) continue;
      items.push({
        ...toView(row),
        scopeName: name,
        scopeHref: `${SCOPE_PATHS[row.scopeType]}/${row.scopeId}`,
      });
      if (items.length === limit) return { items, nextCursor: cursor };
    }
    if (page.length < OPS_INSIGHT_READ_LIMITS.inboxPage) return { items, nextCursor: null };
  }
  return { items, nextCursor: cursor };
}
