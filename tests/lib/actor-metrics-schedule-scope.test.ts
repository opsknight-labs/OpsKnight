import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ calculate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/sla-server', () => ({
  calculateSLAMetrics: mocks.calculate,
  calculateMultiServiceUptime: vi.fn(),
}));

import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { scheduleReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
  id: 'u1',
  role,
  status: 'ACTIVE',
  teamIds: ['team-a'],
});

describe('calculateActorSLAMetrics on-call scope', () => {
  beforeEach(() => mocks.calculate.mockReset().mockResolvedValue({}));

  it('limits on-call data to the schedules a scoped user can read', async () => {
    await calculateActorSLAMetrics(actor('USER'), { scheduleScope: {} });
    const filters = mocks.calculate.mock.calls[0][0];
    expect(filters.scheduleScope).toEqual(scheduleReadWhere(actor('USER')));
    expect(filters.scheduleScope).not.toEqual({});
  });

  it('keeps org-wide on-call data for roles with global schedule access', async () => {
    await calculateActorSLAMetrics(actor('RESPONDER'));
    expect(mocks.calculate.mock.calls[0][0].scheduleScope).toEqual({});
  });
});
