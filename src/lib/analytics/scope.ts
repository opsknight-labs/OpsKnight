import type { Prisma } from '@prisma/client';
import { actorMetricReadScope, serviceReadWhere } from '@/lib/authorization-filters';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { actorScheduleScope } from '@/lib/actor-metrics';
import {
  compileIncidentMetricFilter,
  type IncidentMetricFilter,
} from '@/lib/metrics/domain/filter';
import { UNASSIGNED, type AnalyticsParams } from './params';

/** SQL alias every analytics query uses for "Incident". */
export const INCIDENT_ALIAS = 'i';

/**
 * Row-level scope for one request. It can only be built from an actor, so
 * there is no way to run an analytics query without authorization applied.
 */
export type AnalyticsScope = {
  /** `AND ...` fragment over alias `i` (filters + authorization), or empty. */
  incidentSql: Prisma.Sql;
  scheduleWhere: Prisma.OnCallScheduleWhereInput;
  /** Services the actor may read, narrowed by the service/team filters. */
  serviceWhere: Prisma.ServiceWhereInput;
  /** For actor-first helpers (uptime, objectives) that take the actor itself. */
  actor: AuthorizationActor;
  /** Identity of authorization + filters, for cache keys. */
  key: string;
};

export function toIncidentMetricFilter(params: AnalyticsParams): IncidentMetricFilter {
  return {
    serviceId: params.services,
    teamId: params.teams,
    priority: params.priorities,
    urgency: params.urgency,
    status: params.status,
    ...(params.assignee
      ? { assigneeId: params.assignee === UNASSIGNED ? null : params.assignee }
      : {}),
  };
}

export function buildAnalyticsScope(
  actor: AuthorizationActor,
  params: AnalyticsParams
): AnalyticsScope {
  const compiled = compileIncidentMetricFilter(
    { ...toIncidentMetricFilter(params), ...actorMetricReadScope(actor) },
    INCIDENT_ALIAS
  );
  const scheduleWhere = actorScheduleScope(actor);
  const serviceWhere: Prisma.ServiceWhereInput = {
    AND: [
      authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ }).allowed
        ? serviceReadWhere(actor)
        : { id: { in: [] } },
      params.services.length ? { id: { in: params.services } } : {},
      params.teams.length ? { teamId: { in: params.teams } } : {},
    ],
  };
  return {
    incidentSql: compiled.sql,
    scheduleWhere,
    serviceWhere,
    actor,
    key: JSON.stringify({
      filter: compiled.identity,
      schedules: scheduleWhere,
      services: serviceWhere,
    }),
  };
}
