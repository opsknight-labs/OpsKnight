import type { Prisma } from '@prisma/client';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

export function incidentReadWhere(actor: AuthorizationActor): Prisma.IncidentWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Incident access denied.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
  if (decision.scope === 'global') return {};
  return {
    OR: [
      { assigneeId: actor.id },
      { watchers: { some: { userId: actor.id } } },
      {
        AND: [
          { visibility: 'PUBLIC' },
          {
            OR: [
              { teamId: { in: [...actor.teamIds] } },
              { service: { teamId: { in: [...actor.teamIds] } } },
            ],
          },
        ],
      },
    ],
  };
}

export function serviceReadWhere(actor: AuthorizationActor): Prisma.ServiceWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Service access denied.',
      CAPABILITIES.SERVICE_READ_SCOPED
    );
  }
  return decision.scope === 'global' ? {} : { teamId: { in: [...actor.teamIds] } };
}

export function dashboardUserReadWhere(actor: AuthorizationActor): Prisma.UserWhereInput {
  const incidentDecision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!incidentDecision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Dashboard access denied.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
  if (incidentDecision.scope === 'global') return {};
  return {
    OR: [
      { id: actor.id },
      { teamMemberships: { some: { teamId: { in: [...actor.teamIds] } } } },
    ],
  };
}

export function dashboardMetricsScope(actor: AuthorizationActor): {
  teamId?: string[];
  useOrScope?: boolean;
} {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Dashboard metrics access denied.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
  return decision.scope === 'global'
    ? {}
    : { teamId: [...actor.teamIds], useOrScope: true };
}
