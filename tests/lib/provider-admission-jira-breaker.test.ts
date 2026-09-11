import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    providerAdmission: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import { recordProviderFailure } from '@/lib/provider-admission';

describe('provider admission breaker for Jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({});
  });

  it('opens after a second transient failure even without Retry-After', async () => {
    mocks.findUnique.mockResolvedValue({ consecutiveFails: 1, blockedUntil: null });

    await recordProviderFailure('jira:workspace', { statusCode: 503 });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'jira:workspace' },
        update: expect.objectContaining({
          state: 'OPEN',
          blockedUntil: expect.any(Date),
          lastStatusCode: 503,
        }),
      })
    );
  });

  it('honors a provider Retry-After on the first 429', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await recordProviderFailure('jira:workspace', { statusCode: 429, retryAfterMs: 45_000 });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: 'OPEN',
          blockedUntil: expect.any(Date),
          consecutiveFails: 1,
          lastStatusCode: 429,
        }),
      })
    );
  });
});
