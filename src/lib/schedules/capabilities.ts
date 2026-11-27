import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, capabilitiesOf, type Capability } from '@/lib/authorization';

export type ScheduleUICapabilities = {
  canViewSchedule: boolean;
  canManageRotation: boolean;
  canManageScheduleSettings: boolean;
  canCreateOverride: boolean;
  canDeleteOverride: boolean;
  canDeleteSchedule: boolean;
};

type ScheduleCapabilityContext = {
  capabilities: readonly Capability[];
  isAdmin: boolean;
  isAssignedMember: boolean;
  isOwningTeamLead: boolean;
  hasScopedView: boolean;
};

export function deriveScheduleUICapabilities({
  capabilities,
  isAdmin,
  isAssignedMember,
  isOwningTeamLead,
  hasScopedView,
}: ScheduleCapabilityContext): ScheduleUICapabilities {
  const canManageRotation = capabilities.includes(CAPABILITIES.OPERATIONS_MANAGE);
  // Overrides put someone on call, so the schedule relation alone is not enough: the person
  // also needs operator rights (an AUDITOR placed in a layer stays read-only).
  const canManageOverrides =
    isAdmin || (canManageRotation && (isAssignedMember || isOwningTeamLead));

  return {
    canViewSchedule:
      capabilities.includes(CAPABILITIES.SCHEDULE_READ_ALL) ||
      hasScopedView ||
      isAdmin ||
      isAssignedMember ||
      isOwningTeamLead,
    canManageRotation,
    canManageScheduleSettings: canManageRotation,
    canCreateOverride: canManageOverrides,
    canDeleteOverride: canManageOverrides,
    canDeleteSchedule: isAdmin,
  };
}

/** How a person relates to one schedule, as the override rules need it. Null when it is gone. */
export async function loadScheduleRelation(
  db: Pick<Prisma.TransactionClient, 'onCallSchedule'>,
  scheduleId: string,
  userId: string
) {
  const schedule = await db.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      layers: {
        select: {
          users: { where: { userId }, select: { id: true } },
        },
      },
      overrides: {
        where: { OR: [{ userId }, { replacesUserId: userId }] },
        select: { id: true },
        take: 1,
      },
      escalationRules: {
        where: {
          policy: {
            services: {
              some: {
                team: { members: { some: { userId, role: 'OWNER' } } },
              },
            },
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!schedule) return null;
  const isAssignedMember = schedule.layers.some(layer => layer.users.length > 0);
  return {
    isAssignedMember,
    isOwningTeamLead: schedule.escalationRules.length > 0,
    hasScopedView: isAssignedMember || schedule.overrides.length > 0,
  };
}

/**
 * The override rule behind the schedule UI, for API v2 callers: the same capability and schedule
 * relation decide, so a responder who is not on the schedule is refused on both surfaces.
 */
export async function assertCanManageScheduleOverrides(
  db: Pick<Prisma.TransactionClient, 'onCallSchedule'>,
  scheduleId: string,
  actor: { id: string; role: string; capabilities?: ReadonlySet<Capability> }
): Promise<void> {
  const capabilities = capabilitiesOf({
    role: actor.role,
    capabilities: actor.capabilities ? [...actor.capabilities] : undefined,
  });
  if (capabilities.includes(CAPABILITIES.ADMIN_MANAGE)) return;
  const relation = await loadScheduleRelation(db, scheduleId, actor.id);
  if (!relation) {
    throw new AppError({ code: 'SCHEDULE_NOT_FOUND', userMessage: 'Schedule not found.' });
  }
  if (!deriveScheduleUICapabilities({ capabilities, isAdmin: false, ...relation }).canCreateOverride) {
    throw new AppError({
      code: 'SCHEDULE_OVERRIDE_ACCESS_DENIED',
      userMessage:
        'Only an administrator, or an operator who is on this schedule or leads its owning team, can manage overrides.',
      details: { scheduleId, userId: actor.id },
    });
  }
}
