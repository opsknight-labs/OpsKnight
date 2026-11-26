import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  services: vi.fn(),
  shifts: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    systemSettings: { findUnique: mocks.settings },
    user: { findMany: async () => [] },
    businessService: { findMany: mocks.services },
    inAppNotification: { findMany: async () => [] },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: vi.fn() }));
vi.mock('@/lib/oncall-shifts', () => ({ getActiveOnCallShifts: mocks.shifts }));

import {
  runBusinessServiceHygieneIfDue,
  runBusinessServiceHygieneSweep,
} from '@/lib/business-services/hygiene-sweep';

const service = (id: string) => ({
  id,
  name: id,
  createdAt: new Date('2026-01-01'),
  lastReviewedAt: null,
  reviewIntervalDays: null,
  ownerUserId: null,
  ownerUser: null,
  ownerTeamId: `team-${id}`,
  ownerTeam: {
    members: [{ role: 'MEMBER', user: { id: 'u', role: 'RESPONDER', status: 'ACTIVE' } }],
  },
  escalationPolicy: { steps: [{ targetScheduleId: `sched-${id}` }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shifts.mockResolvedValue([]);
});

describe('hygiene sweep', () => {
  it('looks up on-call shifts once per batch, not once per service', async () => {
    mocks.services.mockResolvedValue(['a', 'b', 'c'].map(service));
    await runBusinessServiceHygieneSweep(new Date('2026-11-26T10:00:00Z'));
    expect(mocks.shifts).toHaveBeenCalledTimes(1);
  });

  it('does not use up the hourly slot while disabled or after a failed run', async () => {
    const now = new Date('2030-01-01T10:00:00Z');
    mocks.settings.mockResolvedValueOnce({ businessServiceHygieneEnabled: false });
    expect(await runBusinessServiceHygieneIfDue(now)).toBeNull();
    mocks.settings.mockResolvedValue({ businessServiceHygieneEnabled: true });
    mocks.services.mockRejectedValueOnce(new Error('db down'));
    await expect(runBusinessServiceHygieneIfDue(now)).rejects.toThrow('db down');
    mocks.services.mockResolvedValue([]);
    expect(await runBusinessServiceHygieneIfDue(now)).toMatchObject({ flagged: 0 });
  });
});
