/**
 * Centralized escalation target resolution.
 *
 * This is the only place that turns a policy step's target into a set of
 * responder user IDs. It resolves state; it never mutates it.
 *
 * Two rules matter more than anything else here:
 *
 * 1. Only `ACTIVE` users are eligible. An invited-but-not-onboarded or a
 *    disabled account must never be paged or made an incident's owner.
 * 2. Infrastructure failures are thrown, never flattened into an empty
 *    recipient list. "The database was unreachable" and "nobody is on call"
 *    lead to opposite escalation decisions, so they must stay distinguishable.
 */
import type { EscalationTargetType } from '@prisma/client';
import prisma from '../prisma';
import {
  buildScheduleBlocks,
  getFinalScheduleBlocks,
  type LayerInput,
  type LayerRestrictions,
  type OverrideInput,
} from '../oncall';
import { startOfDayInTimeZone, startOfNextDayInTimeZone } from '../timezone';

export type EscalationTargetResolution =
  | { outcome: 'RESOLVED'; userIds: string[]; targetName: string }
  | { outcome: 'NO_ELIGIBLE_RESPONDERS'; targetName: string }
  | { outcome: 'INVALID_TARGET'; reason: string };

/**
 * A resolution attempt that failed for infrastructure reasons. The caller must
 * retry the escalation step rather than treat the target as unreachable.
 */
export class EscalationInfrastructureError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EscalationInfrastructureError';
  }
}

async function infrastructureGuarded<T>(what: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw new EscalationInfrastructureError(`Failed to resolve escalation ${what}`, {
      cause: error,
    });
  }
}

/** Deterministic ordering so repeated resolutions of one target agree. */
function stableUserIds(userIds: Iterable<string>): string[] {
  return [...new Set(userIds)].sort();
}

async function resolveUserTarget(targetId: string): Promise<EscalationTargetResolution> {
  const user = await infrastructureGuarded('user target', () =>
    prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, status: true },
    })
  );

  if (!user) {
    return { outcome: 'INVALID_TARGET', reason: 'Target user no longer exists' };
  }
  if (user.status !== 'ACTIVE') {
    return {
      outcome: 'INVALID_TARGET',
      reason: `Target user is ${user.status.toLowerCase()}, not an active responder`,
    };
  }
  return { outcome: 'RESOLVED', userIds: [user.id], targetName: user.name || 'Unknown User' };
}

async function resolveTeamTarget(
  targetId: string,
  notifyOnlyTeamLead: boolean
): Promise<EscalationTargetResolution> {
  const team = await infrastructureGuarded('team target', () =>
    prisma.team.findUnique({
      where: { id: targetId },
      select: {
        name: true,
        teamLeadId: true,
        members: {
          where: { receiveTeamNotifications: true },
          select: { userId: true, user: { select: { status: true } } },
        },
      },
    })
  );

  if (!team) {
    return { outcome: 'INVALID_TARGET', reason: 'Target team no longer exists' };
  }

  const targetName = team.name || 'Unknown Team';
  const eligible = stableUserIds(
    team.members.filter(member => member.user?.status === 'ACTIVE').map(member => member.userId)
  );

  if (notifyOnlyTeamLead) {
    // A lead-only step that has no eligible lead pages nobody: silently
    // widening to the whole team would page responders the policy excluded.
    const leadIsEligible = Boolean(team.teamLeadId) && eligible.includes(team.teamLeadId!);
    return leadIsEligible
      ? { outcome: 'RESOLVED', userIds: [team.teamLeadId!], targetName }
      : { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName };
  }

  return eligible.length > 0
    ? { outcome: 'RESOLVED', userIds: eligible, targetName }
    : { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName };
}

async function resolveScheduleTarget(
  targetId: string,
  atTime: Date
): Promise<EscalationTargetResolution> {
  const schedule = await infrastructureGuarded('schedule target', () =>
    prisma.onCallSchedule.findUnique({
      where: { id: targetId },
      select: {
        name: true,
        timeZone: true,
        layers: {
          include: {
            users: {
              include: { user: true },
              orderBy: { position: 'asc' },
            },
          },
        },
        overrides: {
          where: {
            start: { lte: atTime },
            end: { gt: atTime },
            user: { status: 'ACTIVE' },
          },
          include: { user: true },
        },
      },
    })
  );

  if (!schedule) {
    return { outcome: 'INVALID_TARGET', reason: 'Target schedule no longer exists' };
  }

  const targetName = schedule.name || 'Unknown Schedule';
  if (schedule.layers.length === 0 && schedule.overrides.length === 0) {
    return { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName };
  }

  const userIds = effectiveOnCallUserIds(schedule, atTime);
  return userIds.length > 0
    ? { outcome: 'RESOLVED', userIds, targetName }
    : { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName };
}

/**
 * Row shapes as loaded above, keeping the legacy layer columns older schedules
 * may still carry so the adapter below can normalise them in one place.
 */
type ScheduleLayerRow = {
  id: string;
  name: string;
  start: Date;
  end?: Date | null;
  rotationLengthHours?: number | null;
  shiftLengthHours?: number | null;
  shiftDuration?: number | null;
  rotationType?: string | null;
  restrictions?: unknown;
  priority?: number | null;
  order?: number | null;
  users: Array<{
    userId: string;
    position?: number | null;
    user?: {
      name?: string | null;
      avatarUrl?: string | null;
      gender?: string | null;
      status?: string | null;
    } | null;
  }>;
};

type ScheduleOverrideRow = {
  id: string;
  userId: string;
  replacesUserId: string | null;
  start: Date;
  end: Date;
  user?: { name?: string | null; avatarUrl?: string | null; gender?: string | null } | null;
};

type ScheduleForCoverage = {
  timeZone: string;
  layers: ScheduleLayerRow[];
  overrides: ScheduleOverrideRow[];
};

function layerPriorityOf(layer: ScheduleLayerRow): number {
  return layer.priority ?? 100 - (layer.order ?? 0);
}

function layerRotationLengthHours(layer: ScheduleLayerRow): number {
  if (layer.rotationLengthHours) return layer.rotationLengthHours;
  if (layer.shiftDuration) return layer.shiftDuration / 60;
  return layer.rotationType === 'WEEKLY' ? 168 : 24;
}

/**
 * Effective coverage at an exact instant, via the canonical schedule engine so
 * layer priority, replacement/additive overrides, restrictions, and DST behave
 * identically to what the on-call UI shows.
 */
function effectiveOnCallUserIds(schedule: ScheduleForCoverage, atTime: Date): string[] {
  const windowStart = startOfDayInTimeZone(atTime, schedule.timeZone);
  const windowEnd = startOfNextDayInTimeZone(atTime, schedule.timeZone);

  const layerPriority = new Map<string, number>(
    schedule.layers.map(layer => [layer.id, layerPriorityOf(layer)])
  );

  const layers: LayerInput[] = schedule.layers.map(layer => {
    const rotationLengthHours = layerRotationLengthHours(layer);
    return {
      id: layer.id,
      name: layer.name,
      start: layer.start,
      end: layer.end ?? null,
      rotationLengthHours,
      shiftLengthHours: layer.shiftLengthHours ?? rotationLengthHours,
      restrictions: (layer.restrictions ?? null) as LayerRestrictions | null,
      priority: layerPriorityOf(layer),
      users: layer.users
        .filter(entry => entry.user?.status === 'ACTIVE')
        .map((entry, index) => ({
          userId: entry.userId,
          position: entry.position ?? index,
          user: {
            name: entry.user?.name || '',
            avatarUrl: entry.user?.avatarUrl,
            gender: entry.user?.gender,
          },
        })),
    };
  });

  const overrides: OverrideInput[] = schedule.overrides.map(override => ({
    id: override.id,
    userId: override.userId,
    replacesUserId: override.replacesUserId,
    start: override.start,
    end: override.end,
    user: {
      name: override.user?.name || '',
      avatarUrl: override.user?.avatarUrl,
      gender: override.user?.gender,
    },
  }));

  const blocks = buildScheduleBlocks(layers, overrides, windowStart, windowEnd, schedule.timeZone);

  const activeAt = getFinalScheduleBlocks(blocks, layerPriority).filter(
    block => block.start.getTime() <= atTime.getTime() && block.end.getTime() > atTime.getTime()
  );

  // A coverage gap resolves to nobody. Falling back to the whole roster would
  // page every member of the schedule for an uncovered hour.
  return stableUserIds(
    activeAt.map(block => block.userId).filter((userId): userId is string => Boolean(userId))
  );
}

/** The single escalation target resolution contract. */
export async function resolveEscalationTargetDetailed(input: {
  targetType: EscalationTargetType;
  targetId: string;
  at?: Date;
  notifyOnlyTeamLead?: boolean;
}): Promise<EscalationTargetResolution> {
  const at = input.at ?? new Date();

  switch (input.targetType) {
    case 'USER':
      return resolveUserTarget(input.targetId);
    case 'TEAM':
      return resolveTeamTarget(input.targetId, input.notifyOnlyTeamLead ?? false);
    case 'SCHEDULE':
      return resolveScheduleTarget(input.targetId, at);
    default:
      return {
        outcome: 'INVALID_TARGET',
        reason: `Unsupported escalation target type: ${String(input.targetType)}`,
      };
  }
}

/**
 * Convenience wrapper for read-only callers (the on-call API, ChatOps lookups)
 * that only need the eligible responder list. Escalation execution must use
 * `resolveEscalationTargetDetailed` so it can tell an unusable target apart
 * from an uncovered one.
 */
export async function resolveEscalationTarget(
  targetType: EscalationTargetType,
  targetId: string,
  atTime: Date = new Date(),
  notifyOnlyTeamLead: boolean = false
): Promise<string[]> {
  const resolution = await resolveEscalationTargetDetailed({
    targetType,
    targetId,
    at: atTime,
    notifyOnlyTeamLead,
  });
  return resolution.outcome === 'RESOLVED' ? resolution.userIds : [];
}
