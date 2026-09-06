import { CAPABILITIES, type Capability } from '@/lib/authorization';

export type ScheduleUICapabilities = {
  canViewSchedule: boolean;
  canManageRotation: boolean;
  canManageScheduleSettings: boolean;
  canCreateOverride: boolean;
  canDeleteOverride: boolean;
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
  const canManageOverrides = isAdmin || isAssignedMember || isOwningTeamLead;

  return {
    canViewSchedule:
      capabilities.includes(CAPABILITIES.SCHEDULE_READ_ALL) || hasScopedView || canManageOverrides,
    canManageRotation,
    canManageScheduleSettings: canManageRotation,
    canCreateOverride: canManageOverrides,
    canDeleteOverride: canManageOverrides,
  };
}
