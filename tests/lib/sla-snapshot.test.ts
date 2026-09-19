import { describe, expect, it, vi } from 'vitest';

const { infoMock, snapshotUpsertMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
  snapshotUpsertMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { sLASnapshot: { upsert: snapshotUpsertMock } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: infoMock, warn: vi.fn(), error: vi.fn() },
}));

import { generateDailySnapshot } from '@/lib/sla-server';

describe('generateDailySnapshot compatibility entry point', () => {
  it('is a logged no-op and never writes legacy snapshot history', async () => {
    const date = new Date('2026-08-01T12:00:00.000Z');
    await generateDailySnapshot('sla-1', date);
    expect(snapshotUpsertMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith('[Legacy SLA] Ignored retired snapshot request', {
      definitionId: 'sla-1',
      date: date.toISOString(),
    });
  });
});
