import type { Prisma } from '@prisma/client';
import type { IncidentMetricFilter } from '@/lib/metrics/domain/filter';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

export type IncidentReadParts =
  | { global: true }
  | {
      global: false;
      /** Visible to this actor individually (assigned or watching): unique per user. */
      personal: Prisma.IncidentWhereInput[];
      /** Visible through team membership: identical for every actor with the same team set. */
      shared: Prisma.IncidentWhereInput;
    };

/**
 * The single source of truth for scoped incident visibility. `incidentReadWhere` is composed from
 * these parts, so projections that cache the team-shared part once per team set and the
 * per-user part separately can never drift from the authorization policy.
 */
export function incidentReadWhereParts(actor: AuthorizationActor): IncidentReadParts {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Incident access denied.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
  if (decision.scope === 'global') return { global: true };
  return {
    global: false,
    personal: [{ assigneeId: actor.id }, { watchers: { some: { userId: actor.id } } }],
    shared: {
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
  };
}

export function incidentReadWhere(actor: AuthorizationActor): Prisma.IncidentWhereInput {
  const parts = incidentReadWhereParts(actor);
  if (parts.global) return {};
  return { OR: [...parts.personal, parts.shared] };
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

export function integrationReadWhere(actor: AuthorizationActor): Prisma.IntegrationWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INTEGRATION_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Integration access denied.',
      CAPABILITIES.SERVICE_READ_SCOPED
    );
  }
  return decision.scope === 'global' ? {} : { service: { teamId: { in: [...actor.teamIds] } } };
}

export function teamReadWhere(actor: AuthorizationActor): Prisma.TeamWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Team access denied.',
      CAPABILITIES.SERVICE_READ_SCOPED
    );
  }
  return decision.scope === 'global' ? {} : { id: { in: [...actor.teamIds] } };
}

export function scheduleReadWhere(actor: AuthorizationActor): Prisma.OnCallScheduleWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SCHEDULE_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Schedule access denied.',
      CAPABILITIES.SCHEDULE_READ_SCOPED
    );
  }
  if (decision.scope === 'global') return {};
  return {
    OR: [
      { layers: { some: { users: { some: { userId: actor.id } } } } },
      { overrides: { some: { OR: [{ userId: actor.id }, { replacesUserId: actor.id }] } } },
      {
        escalationRules: {
          some: {
            policy: {
              services: {
                some: { team: { members: { some: { userId: actor.id, role: 'OWNER' } } } },
              },
            },
          },
        },
      },
    ],
  };
}

export function actorMetricReadScope(
  actor: AuthorizationActor
): Pick<IncidentMetricFilter, 'authorizationScope'> {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ });
  if (!decision.allowed) {
    throw new AuthorizationError(
      'Forbidden. Analytics access denied.',
      CAPABILITIES.INCIDENT_READ_SCOPED
    );
  }
  return decision.scope === 'global'
    ? {}
    : { authorizationScope: { actorId: actor.id, teamIds: [...actor.teamIds] } };
}

export function actionItemReadWhere(actor: AuthorizationActor): Prisma.ActionItemWhereInput {
  return { incident: incidentReadWhere(actor) };
}

export function postmortemReadWhere(actor: AuthorizationActor): Prisma.PostmortemWhereInput {
  return { incident: incidentReadWhere(actor) };
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
    OR: [{ id: actor.id }, { teamMemberships: { some: { teamId: { in: [...actor.teamIds] } } } }],
  };
}

export function dashboardMetricsScope(
  actor: AuthorizationActor
): Pick<IncidentMetricFilter, 'authorizationScope'> {
  return actorMetricReadScope(actor);
}

/** Runbook library visibility follows the services a scoped reader can operate. */
export function runbookReadWhere(actor: AuthorizationActor): Prisma.RunbookWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_READ });
  if (!decision.allowed)
    throw new AuthorizationError(
      'Forbidden. Runbook access denied.',
      CAPABILITIES.RUNBOOK_READ_SCOPED
    );
  return decision.scope === 'global'
    ? {}
    : {
        bindings: { some: { detachedAt: null, service: { teamId: { in: [...actor.teamIds] } } } },
      };
}

export function runbookExecutionReadWhere(
  actor: AuthorizationActor
): Prisma.RunbookExecutionWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_READ });
  if (!decision.allowed)
    throw new AuthorizationError(
      'Forbidden. Execution access denied.',
      CAPABILITIES.RUNBOOK_READ_SCOPED
    );
  if (decision.scope === 'global') return {};
  // Apply the incident's visibility rules using the same role, without demanding a second API scope.
  const incidentVisibility = incidentReadWhere({ ...actor, apiKey: undefined });
  return {
    OR: [
      { incident: incidentVisibility },
      {
        incidentId: null,
        OR: [{ triggeredByUserId: actor.id }, { service: { teamId: { in: [...actor.teamIds] } } }],
      },
    ],
  };
}
