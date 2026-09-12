import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { systemConfig: { findUnique } },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/metrics/operational/registry', () => ({ setOperationalGauge: vi.fn() }));

import {
  getSlaSchedulerMode,
  invalidateSlaSchedulerMode,
} from '@/lib/incident-sla/scheduler-control';

describe('SLA scheduler runtime control', () => {
  beforeEach(() => {
    findUnique.mockReset();
    invalidateSlaSchedulerMode();
  });

  it('falls back to legacy mode for a short interval when configuration storage is unavailable', async () => {
    findUnique.mockRejectedValue(new Error('database unavailable'));

    await expect(getSlaSchedulerMode(100)).resolves.toBe('LEGACY');
    await expect(getSlaSchedulerMode(101)).resolves.toBe('LEGACY');
    expect(findUnique).toHaveBeenCalledOnce();
  });
});
