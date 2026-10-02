import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyTokenCandidates, hashTokenV2 } from '@/lib/api-keys';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

type StatusApiAuthResult = {
  allowed: boolean;
  tokenId?: string;
  error?: string;
  status?: number;
  retryAfter?: number;
};

const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60;

function extractToken(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return null;
}

async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const rate = await checkRateLimit(key, limit, windowMs);
  if (rate.allowed) return null;
  return {
    allowed: false,
    error: 'Rate limit exceeded',
    status: 429,
    retryAfter: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)),
  } satisfies StatusApiAuthResult;
}

export async function authorizeStatusApiRequest(
  req: NextRequest,
  statusPageId: string,
  options: {
    requireToken: boolean;
    rateLimitEnabled: boolean;
    rateLimitMax?: number | null;
    rateLimitWindowSec?: number | null;
  }
): Promise<StatusApiAuthResult> {
  const limit = options.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX;
  const windowMs = (options.rateLimitWindowSec ?? DEFAULT_RATE_LIMIT_WINDOW_SEC) * 1000;
  if (options.rateLimitEnabled) {
    const preAuthLimit = await enforceRateLimit(
      `status-api:ip:${getClientIp(req.headers)}`,
      limit,
      windowMs
    );
    if (preAuthLimit) return preAuthLimit;
  }

  const token = extractToken(req);
  let tokenHash: string | null = null;
  let tokenRecord: { id: string } | null = null;

  if (token) {
    // Try V2 hash first (HMAC-SHA256 - Secure)
    tokenHash = hashTokenV2(token);
    tokenRecord = await prisma.statusPageApiToken.findFirst({
      where: {
        statusPageId,
        tokenHash,
        revokedAt: null,
      },
      select: { id: true },
    });

    // Lazy migration: preserve 1.x scrypt tokens and 2.0 HMACs signed with
    // NEXTAUTH_SECRET before an independent API_KEY_SECRET was configured.
    if (!tokenRecord) {
      const legacyHashes = await hashLegacyTokenCandidates(token);
      if (legacyHashes.length > 0) {
        tokenRecord = await prisma.statusPageApiToken.findFirst({
          where: {
            statusPageId,
            tokenHash: { in: legacyHashes },
            revokedAt: null,
          },
          select: { id: true },
        });
      }

      if (tokenRecord) {
        await prisma.statusPageApiToken.update({
          where: { id: tokenRecord.id },
          data: { tokenHash },
        });
      }
    }
  }

  if (options.requireToken && !tokenRecord) {
    return { allowed: false, error: 'API token required', status: 401 };
  }

  if (tokenRecord) {
    await prisma.statusPageApiToken.updateMany({
      where: {
        id: tokenRecord.id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
      },
      data: { lastUsedAt: new Date() },
    });
  }

  if (options.rateLimitEnabled) {
    if (tokenRecord) {
      const tokenLimit = await enforceRateLimit(
        `status-api:token:${tokenRecord.id}`,
        limit,
        windowMs
      );
      if (tokenLimit) return tokenLimit;
    }
  }

  return { allowed: true, tokenId: tokenRecord?.id };
}
