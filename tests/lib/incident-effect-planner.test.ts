import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { planIncidentEffects } from '@/lib/incident-effect-planner';
vi.mock('@/lib/prisma', () => ({ default: { chatOpsConfig: { findUnique: vi.fn() } } }));

describe('execution-time incident effect planner', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([null, { enabled: false, revision: 4 }])(
    'omits disabled default collaboration: %j',
    async config => {
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue(config as never);
      const plan = await planIncidentEffects(1);
      expect(plan.collaboration).toBe('DISABLED');
      expect(Object.isFrozen(plan)).toBe(true);
    }
  );
  it('refreshes a negative decision when configuration is enabled before a retry', async () => {
    vi.mocked(prisma.chatOpsConfig.findUnique)
      .mockResolvedValueOnce({ enabled: false, revision: 4 } as never)
      .mockResolvedValueOnce({ enabled: true, revision: 5 } as never);
    expect((await planIncidentEffects(1)).collaboration).toBe('DISABLED');
    expect(await planIncidentEffects(1)).toEqual({ collaboration: 'EXECUTE', chatOpsRevision: 5 });
    expect(prisma.chatOpsConfig.findUnique).toHaveBeenCalledTimes(2);
  });
  it('propagates failed reads so unknown configuration cannot silently drop work', async () => {
    vi.mocked(prisma.chatOpsConfig.findUnique).mockRejectedValue(new Error('database unavailable'));
    await expect(planIncidentEffects(1)).rejects.toThrow('database unavailable');
  });
});

it.each([undefined, 0, 2, 7])(
  'keeps overlapping/legacy attempt %s on the original handoff',
  async attempt => {
    vi.clearAllMocks();
    expect(await planIncidentEffects(attempt)).toEqual({
      collaboration: 'EXECUTE',
      chatOpsRevision: null,
    });
    expect(prisma.chatOpsConfig.findUnique).not.toHaveBeenCalled();
  }
);
