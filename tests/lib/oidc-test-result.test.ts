// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@/lib/prisma', () => ({
  default: {
    oidcTestFlow: { findUnique: vi.fn() },
    oidcRevision: { findUnique: vi.fn() },
    oidcRevisionTest: { findFirst: vi.fn() },
  },
}));

import prisma from '@/lib/prisma';
import { PROOF_MAX_AGE_MS, readOidcTestResult } from '@/lib/auth-control/oidc-revisions';

const browserToken = 'b'.repeat(43);
const flowId = 'cflowidentifier000000001';
const reference = `${flowId}.${browserToken}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const createdAt = new Date(Date.now() - 60_000);

describe('administrator test result page evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.oidcTestFlow.findUnique).mockResolvedValue({
      id: flowId,
      revisionId: 'rev-1',
      adminUserId: 'admin-1',
      browserHash: digest(browserToken),
      consumedAt: new Date(),
      createdAt,
    } as never);
    vi.mocked(prisma.oidcRevision.findUnique).mockResolvedValue({ id: 'rev-1' } as never);
    vi.mocked(prisma.oidcRevisionTest.findFirst).mockResolvedValue(null);
  });

  it.each([undefined, '', 'verified', 'outcome=verified', `${flowId}.short`])(
    'never shows a result for a missing or fabricated reference (%s)',
    async value => {
      expect(await readOidcTestResult(value)).toEqual({ outcome: 'unavailable' });
      expect(prisma.oidcRevisionTest.findFirst).not.toHaveBeenCalled();
    }
  );

  it('rejects a reference whose browser token does not match the initiating browser', async () => {
    expect(await readOidcTestResult(`${flowId}.${'x'.repeat(43)}`)).toEqual({
      outcome: 'unavailable',
    });
  });

  it('rejects a flow that was never consumed by a callback', async () => {
    vi.mocked(prisma.oidcTestFlow.findUnique).mockResolvedValue({
      id: flowId,
      browserHash: digest(browserToken),
      consumedAt: null,
    } as never);
    expect(await readOidcTestResult(reference)).toEqual({ outcome: 'unavailable' });
  });

  it('reports failure when no proof was recorded for this test', async () => {
    expect(await readOidcTestResult(reference)).toEqual({
      outcome: 'failed',
      revisionId: 'rev-1',
      reason: 'failed',
    });
    expect(prisma.oidcRevisionTest.findFirst).toHaveBeenCalledWith({
      where: { revisionId: 'rev-1', adminUserId: 'admin-1', verifiedAt: { gte: createdAt } },
      orderBy: { verifiedAt: 'desc' },
    });
  });

  it('reports a precise reason when the revision was deleted during the test', async () => {
    vi.mocked(prisma.oidcRevision.findUnique).mockResolvedValue(null);
    expect(await readOidcTestResult(reference)).toEqual({
      outcome: 'failed',
      revisionId: null,
      reason: 'deleted',
    });
  });

  it('shows verification only when backed by a recorded proof, with its seven-day expiry', async () => {
    const verifiedAt = new Date();
    vi.mocked(prisma.oidcRevisionTest.findFirst).mockResolvedValue({ verifiedAt } as never);
    expect(await readOidcTestResult(reference)).toEqual({
      outcome: 'verified',
      revisionId: 'rev-1',
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: new Date(verifiedAt.getTime() + PROOF_MAX_AGE_MS).toISOString(),
    });
  });
});
