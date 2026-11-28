import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { incidentMeeting: { updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/incident-collaboration/meeting-audit', () => ({
  emitMeetingAuditEvent: vi.fn(),
}));

import { settleMeetingProvisionFailure } from '@/lib/incident-collaboration/meeting-store';

describe('settleMeetingProvisionFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only fails a meeting still PROVISIONING under the same token and generation', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await settleMeetingProvisionFailure('inc-1', 'database unavailable', {
      provisioningToken: 'tok-1',
      generation: 2,
      provider: 'JITSI',
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        incidentId: 'inc-1',
        generation: 2,
        state: 'PROVISIONING',
        provisioningToken: 'tok-1',
      },
      data: expect.objectContaining({
        state: 'FAILED',
        health: 'UNAVAILABLE',
        lastErrorCode: 'PROVISION_FAILED',
      }),
    });
  });
});
