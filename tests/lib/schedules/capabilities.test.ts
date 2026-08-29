import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/authorization';
import { deriveScheduleUICapabilities } from '@/lib/schedules/capabilities';

describe('schedule UI capability contract', () => {
  it('allows administrators to manage rotation, settings, and overrides', () => {
    expect(
      deriveScheduleUICapabilities({
        capabilities: [CAPABILITIES.SCHEDULE_READ_ALL, CAPABILITIES.OPERATIONS_MANAGE],
        isAdmin: true,
        isAssignedMember: false,
        isOwningTeamLead: false,
        hasScopedView: false,
      })
    ).toEqual({
      canViewSchedule: true,
      canManageRotation: true,
      canManageScheduleSettings: true,
      canCreateOverride: true,
      canDeleteOverride: true,
    });
  });

  it('keeps responder rotation access separate from unrelated override access', () => {
    const capabilities = deriveScheduleUICapabilities({
      capabilities: [CAPABILITIES.SCHEDULE_READ_ALL, CAPABILITIES.OPERATIONS_MANAGE],
      isAdmin: false,
      isAssignedMember: false,
      isOwningTeamLead: false,
      hasScopedView: false,
    });

    expect(capabilities.canManageRotation).toBe(true);
    expect(capabilities.canCreateOverride).toBe(false);
  });

  it.each([
    ['assigned schedule member', true, false],
    ['owning team lead', false, true],
  ])('allows %s to manage overrides without rotation settings', (_label, assigned, owner) => {
    const capabilities = deriveScheduleUICapabilities({
      capabilities: [],
      isAdmin: false,
      isAssignedMember: assigned,
      isOwningTeamLead: owner,
      hasScopedView: assigned,
    });

    expect(capabilities.canViewSchedule).toBe(true);
    expect(capabilities.canManageRotation).toBe(false);
    expect(capabilities.canCreateOverride).toBe(true);
    expect(capabilities.canDeleteOverride).toBe(true);
  });

  it('leaves an unrelated viewer without schedule actions', () => {
    expect(
      deriveScheduleUICapabilities({
        capabilities: [],
        isAdmin: false,
        isAssignedMember: false,
        isOwningTeamLead: false,
        hasScopedView: false,
      })
    ).toEqual({
      canViewSchedule: false,
      canManageRotation: false,
      canManageScheduleSettings: false,
      canCreateOverride: false,
      canDeleteOverride: false,
    });
  });
});
