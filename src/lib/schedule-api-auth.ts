import { Prisma } from '@prisma/client';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

export function getScheduleApiScope(actor: AuthorizationActor): Prisma.OnCallScheduleWhereInput {
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
      {
        escalationRules: {
          some: {
            policy: {
              services: {
                some: { team: { members: { some: { userId: actor.id } } } },
              },
            },
          },
        },
      },
    ],
  };
}
