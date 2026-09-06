import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    rateLimit: { deleteMany: mocks.deleteMany, findUnique: mocks.findUnique },
  },
}));
import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  deferProviderAdmission,
  releaseProviderConcurrency,
} from '@/lib/provider-admission';
describe('provider admission control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('opens a new distributed provider window', async () => {
    mocks.queryRaw.mockResolvedValue([{ expiresAt: new Date('2026-08-30T12:00:00.125Z') }]);
    const now = new Date('2026-08-30T12:00:00.000Z');
    await expect(acquireProviderAdmission('EMAIL', 'default', now)).resolves.toEqual({
      allowed: true,
    });
    const query = mocks.queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(query.strings?.join('?')).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(query.strings?.join('?')).toContain('WHERE "RateLimit"."expiresAt" <=');
  });
  it('defers without consuming a provider request when the shared budget is full', async () => {
    const expiresAt = new Date('2026-08-30T12:00:01.500Z');
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ key: 'provider:email:default', count: 8, expiresAt });
    await expect(
      acquireProviderAdmission('EMAIL', 'default', new Date('2026-08-30T12:00:00.500Z'))
    ).resolves.toEqual({
      allowed: false,
      retryAt: new Date('2026-08-30T12:00:00.625Z'),
      reason: 'RATE_LIMITED',
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('persists provider cooldowns monotonically', async () => {
    await deferProviderAdmission('SLACK', 'channel:C123', new Date('2026-08-30T12:01:00.000Z'));

    const query = mocks.executeRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(query.strings?.join('?')).toContain('GREATEST');
    expect(query.strings?.join('?')).toContain('expiresAt');
  });

  it('claims and releases a distributed provider concurrency slot', async () => {
    mocks.queryRaw.mockResolvedValue([{ key: 'provider-inflight:email:default:0' }]);
    await expect(acquireProviderConcurrency('EMAIL', 'default')).resolves.toEqual({
      allowed: true,
      leaseKey: 'provider-inflight:email:default:0',
    });
    await releaseProviderConcurrency('provider-inflight:email:default:0');
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { key: 'provider-inflight:email:default:0' },
    });
  });
});
