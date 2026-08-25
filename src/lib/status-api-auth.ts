import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyScryptToken, hashTokenV2 } from '@/lib/api-keys';
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

function getRateLimitKey(req: NextRequest, tokenHash?: string | null) {
  if (tokenHash) {
    return `status-api:token:${tokenHash}`;
  }
  return `status-api:ip:${getClientIp(req.headers)}`;
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

    // Lazy migration: Try V1 hash if V2 not found
    if (!tokenRecord) {
      const v1Hash = await hashLegacyScryptToken(token);
      tokenRecord = await prisma.statusPageApiToken.findFirst({
        where: {
          statusPageId,
          tokenHash: v1Hash,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (tokenRecord) {
        // Migrate to secure V2 hash
        await prisma.statusPageApiToken.update({
          where: { id: tokenRecord.id },
          data: { tokenHash: hashTokenV2(token) }, // Update to V2 hash
        });
        tokenHash = hashTokenV2(token);
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
    const limit = options.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX;
    const windowMs = (options.rateLimitWindowSec ?? DEFAULT_RATE_LIMIT_WINDOW_SEC) * 1000;
    const rateKey = getRateLimitKey(req, tokenHash);
    const rate = await checkRateLimit(rateKey, limit, windowMs);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return { allowed: false, error: 'Rate limit exceeded', status: 429, retryAfter };
    }
  }

  return { allowed: true, tokenId: tokenRecord?.id };
}
