import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  default: {
    apiKey: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { hashTokenV2 } from '@/lib/api-keys';

const token = 'ok_test_legacy_v2_key_material';

function legacySessionV2Hash(secret: string) {
  return createHmac('sha256', secret)
    .update(`opsknight:api-key:v2:${token}`)
    .digest('hex');
}

describe('API-key secret migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXTAUTH_SECRET', 'historical-session-secret');
    vi.stubEnv('API_KEY_SECRET', 'new-independent-api-key-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a legacy NEXTAUTH_SECRET V2 hash once and rewrites it with API_KEY_SECRET', async () => {
    const legacyHash = legacySessionV2Hash('historical-session-secret');
    const apiKey = {
      id: 'key-1',
      tokenHash: legacyHash,
      userId: 'user-1',
      scopes: ['incidents:read'],
    };

    vi.mocked(prisma.apiKey.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(apiKey as never);
    vi.mocked(prisma.apiKey.update).mockResolvedValue(apiKey as never);

    const request = new NextRequest('https://ops.example.com/api/incidents', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await authenticateApiKey(request);

    expect(result).toEqual(apiKey);
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.apiKey.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: { in: expect.arrayContaining([legacyHash]) },
        }),
      })
    );
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: {
        tokenHash: hashTokenV2(token),
        lastUsedAt: expect.any(Date),
      },
    });
  });
});
