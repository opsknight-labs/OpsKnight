import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/authorization';
import {
  assertCanManageScheduleOverrides,
  deriveScheduleUICapabilities,
} from '@/lib/schedules/capabilities';

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
      canDeleteSchedule: true,
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
  ])('allows an operator who is %s to manage overrides', (_label, assigned, owner) => {
    const capabilities = deriveScheduleUICapabilities({
      capabilities: [CAPABILITIES.OPERATIONS_MANAGE],
      isAdmin: false,
      isAssignedMember: assigned,
      isOwningTeamLead: owner,
      hasScopedView: assigned,
    });

    expect(capabilities.canViewSchedule).toBe(true);
    expect(capabilities.canCreateOverride).toBe(true);
    expect(capabilities.canDeleteOverride).toBe(true);
  });

  it.each([
    ['assigned schedule member', true, false],
    ['owning team lead', false, true],
  ])('keeps a %s without operator rights read-only (an auditor in a layer)', (_label, assigned, owner) => {
    const capabilities = deriveScheduleUICapabilities({
      capabilities: [CAPABILITIES.SCHEDULE_READ_ALL],
      isAdmin: false,
      isAssignedMember: assigned,
      isOwningTeamLead: owner,
      hasScopedView: assigned,
    });

    expect(capabilities.canViewSchedule).toBe(true);
    expect(capabilities.canManageRotation).toBe(false);
    expect(capabilities.canCreateOverride).toBe(false);
    expect(capabilities.canDeleteOverride).toBe(false);
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
      canDeleteSchedule: false,
    });
  });
});

describe('assertCanManageScheduleOverrides (API v2 callers)', () => {
  type Db = Parameters<typeof assertCanManageScheduleOverrides>[0];
  const relationDb = (onSchedule: boolean): Db =>
    ({
      onCallSchedule: {
        findUnique: async () => ({
          layers: [{ users: onSchedule ? [{ id: 'lu1' }] : [] }],
          overrides: [],
          escalationRules: [],
        }),
      },
    }) as unknown as Db;

  it('refuses a responder who is not on the schedule, as the UI does', async () => {
    await expect(
      assertCanManageScheduleOverrides(relationDb(false), 'sch', { id: 'u1', role: 'RESPONDER' })
    ).rejects.toMatchObject({ code: 'SCHEDULE_OVERRIDE_ACCESS_DENIED' });
  });

  it('refuses an auditor who is on the schedule', async () => {
    await expect(
      assertCanManageScheduleOverrides(relationDb(true), 'sch', { id: 'u1', role: 'AUDITOR' })
    ).rejects.toMatchObject({ code: 'SCHEDULE_OVERRIDE_ACCESS_DENIED' });
  });

  it('allows a responder on the schedule and any administrator', async () => {
    await expect(
      assertCanManageScheduleOverrides(relationDb(true), 'sch', { id: 'u1', role: 'RESPONDER' })
    ).resolves.toBeUndefined();
    await expect(
      assertCanManageScheduleOverrides(relationDb(false), 'sch', { id: 'u2', role: 'ADMIN' })
    ).resolves.toBeUndefined();
  });
});
