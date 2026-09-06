import { Prisma, type IncidentStatus } from '@prisma/client';
import { activeIncidentStatuses } from '@/lib/incident-status';

export type IncidentMetricFilter = {
  serviceId?: string | string[];
  teamId?: string | string[];
  assigneeId?: string | null;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  priority?: string | string[];
  status?: 'ACTIVE' | 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'SUPPRESSED' | 'RESOLVED';
  visibility?: 'PUBLIC' | 'PRIVATE' | 'ALL';
  useOrScope?: boolean;
  /**
   * Mandatory row-level authorization scope for user-facing metric reads.
   * Internal/system callers may omit it, but UI/API boundaries must obtain it
   * from the centralized authorization layer rather than constructing it.
   */
  authorizationScope?: {
    actorId: string;
    teamIds: readonly string[];
  };
};

export type MetricFilterIdentity = {
  services: string[];
  teams: string[];
  assignee: string | null | 'any';
  urgency: string | null;
  priorities: string[];
  status: string | null;
  visibility: string | null;
  scope: 'and' | 'or';
  authorization: string | null;
};

const values = (value?: string | readonly string[]): string[] =>
  value ? (typeof value === 'string' ? [value] : [...new Set(value)].sort()) : [];

export function compileIncidentMetricFilter(
  filter: IncidentMetricFilter,
  tableAlias = ''
): { prisma: Prisma.IncidentWhereInput; sql: Prisma.Sql; identity: MetricFilterIdentity } {
  if (tableAlias && !/^[a-z][a-z0-9_]*$/i.test(tableAlias)) {
    throw new Error('Invalid SQL alias');
  }
  const services = values(filter.serviceId);
  const teams = values(filter.teamId);
  const priorities = values(filter.priority);
  const authorizationTeamIds = values(filter.authorizationScope?.teamIds);
  const prisma: Prisma.IncidentWhereInput = {};
  const prismaPredicates: Prisma.IncidentWhereInput[] = [];
  const sqlPredicates: Prisma.Sql[] = [];
  const prismaScopes: Prisma.IncidentWhereInput[] = [];
  const sqlScopes: Prisma.Sql[] = [];
  const column = (name: string) => Prisma.raw(`${tableAlias ? `${tableAlias}.` : ''}"${name}"`);

  if (filter.authorizationScope) {
    const { actorId } = filter.authorizationScope;
    const teamScope: Prisma.IncidentWhereInput = {
      AND: [
        { visibility: 'PUBLIC' },
        {
          OR: [
            { teamId: { in: authorizationTeamIds } },
            { service: { teamId: { in: authorizationTeamIds } } },
          ],
        },
      ],
    };
    prismaPredicates.push({
      OR: [
        { assigneeId: actorId },
        { watchers: { some: { userId: actorId } } },
        ...(authorizationTeamIds.length > 0 ? [teamScope] : []),
      ],
    });

    const teamSql =
      authorizationTeamIds.length > 0
        ? Prisma.sql` OR (${column('visibility')} = 'PUBLIC'::"IncidentVisibility" AND (${column('teamId')} = ANY(${authorizationTeamIds}::text[]) OR ${column('serviceId')} IN (SELECT id FROM "Service" WHERE "teamId" = ANY(${authorizationTeamIds}::text[]))))`
        : Prisma.empty;
    sqlPredicates.push(
      Prisma.sql`(${column('assigneeId')} = ${actorId} OR EXISTS (SELECT 1 FROM "IncidentWatcher" iw WHERE iw."incidentId" = ${column('id')} AND iw."userId" = ${actorId})${teamSql})`
    );
  }

  if (services.length) {
    prismaScopes.push({ serviceId: { in: services } });
    sqlScopes.push(Prisma.sql`${column('serviceId')} = ANY(${services}::text[])`);
  }
  if (teams.length) {
    const serviceTeamPrisma: Prisma.IncidentWhereInput = { service: { teamId: { in: teams } } };
    const serviceTeamSql = Prisma.sql`${column('serviceId')} IN (SELECT id FROM "Service" WHERE "teamId" = ANY(${teams}::text[]))`;
    if (filter.useOrScope) {
      prismaScopes.push({ OR: [{ teamId: { in: teams } }, serviceTeamPrisma] });
      sqlScopes.push(
        Prisma.sql`(${column('teamId')} = ANY(${teams}::text[]) OR ${serviceTeamSql})`
      );
    } else {
      prismaScopes.push(serviceTeamPrisma);
      sqlScopes.push(serviceTeamSql);
    }
  }
  if (filter.assigneeId !== undefined) {
    prismaScopes.push({ assigneeId: filter.assigneeId });
    sqlScopes.push(
      filter.assigneeId === null
        ? Prisma.sql`${column('assigneeId')} IS NULL`
        : Prisma.sql`${column('assigneeId')} = ${filter.assigneeId}`
    );
  }

  if (filter.urgency) {
    prisma.urgency = filter.urgency;
    sqlPredicates.push(Prisma.sql`${column('urgency')} = ${filter.urgency}::"IncidentUrgency"`);
  }
  if (priorities.length) {
    prisma.priority = { in: priorities };
    sqlPredicates.push(Prisma.sql`${column('priority')} = ANY(${priorities}::text[])`);
  }
  if (filter.status) {
    if (filter.status === 'ACTIVE') {
      const statuses = activeIncidentStatuses();
      prisma.status = { in: statuses };
      sqlPredicates.push(Prisma.sql`${column('status')} = ANY(${statuses}::"IncidentStatus"[])`);
    } else {
      prisma.status = filter.status as IncidentStatus;
      sqlPredicates.push(Prisma.sql`${column('status')} = ${filter.status}::"IncidentStatus"`);
    }
  }
  if (filter.visibility && filter.visibility !== 'ALL') {
    prisma.visibility = filter.visibility;
    sqlPredicates.push(
      Prisma.sql`${column('visibility')} = ${filter.visibility}::"IncidentVisibility"`
    );
  }
  if (prismaScopes.length) {
    if (!filter.authorizationScope) {
      if (filter.useOrScope) prisma.OR = prismaScopes;
      else prisma.AND = prismaScopes;
    } else {
      prismaPredicates.push(filter.useOrScope ? { OR: prismaScopes } : { AND: prismaScopes });
    }
  }
  if (prismaPredicates.length) prisma.AND = prismaPredicates;
  if (sqlScopes.length) {
    sqlPredicates.push(
      filter.useOrScope
        ? Prisma.sql`(${Prisma.join(sqlScopes, ' OR ')})`
        : Prisma.sql`(${Prisma.join(sqlScopes, ' AND ')})`
    );
  }

  return {
    prisma,
    sql: sqlPredicates.length
      ? Prisma.sql`AND ${Prisma.join(sqlPredicates, ' AND ')}`
      : Prisma.empty,
    identity: {
      services,
      teams,
      assignee: filter.assigneeId === undefined ? 'any' : filter.assigneeId,
      urgency: filter.urgency ?? null,
      priorities,
      status: filter.status ?? null,
      visibility: filter.visibility === 'ALL' ? null : (filter.visibility ?? null),
      scope: filter.useOrScope ? 'or' : 'and',
      authorization: filter.authorizationScope
        ? `${filter.authorizationScope.actorId}:${authorizationTeamIds.join(',')}`
        : null,
    },
  };
}
