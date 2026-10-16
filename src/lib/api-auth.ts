import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashTokenV2 } from '@/lib/api-keys';
import { isWellFormedApiToken } from '@/lib/api-v2/auth';
import { legacyHashCandidatesWithAdmission } from '@/lib/legacy-token-admission';

function extractApiKey(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  if (header.toLowerCase().startsWith('api-key ')) {
    return header.slice(8).trim();
  }
  const direct = req.headers.get('x-api-key');
  return direct?.trim() || null;
}

type ApiKeyRecord = NonNullable<Awaited<ReturnType<typeof prisma.apiKey.findFirst>>>;

export type ApiKeyAuthResult =
  | { status: 'ok'; key: ApiKeyRecord }
  | { status: 'invalid' }
  | { status: 'throttled'; retryAfter: number };

/**
 * API-key authentication for /api/v1 and the older /api/* routes, with the same admission
 * protections as REST v2: malformed tokens are rejected without database work, and the
 * expensive 1.x scrypt fallback runs under the shared legacy-hash budget and concurrency cap.
 */
export async function authenticateApiKeyDetailed(req: NextRequest): Promise<ApiKeyAuthResult> {
  const token = extractApiKey(req);
  if (!token || !isWellFormedApiToken(token)) return { status: 'invalid' };

  const v2Hash = hashTokenV2(token);
  const activeFilter = {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    user: { status: 'ACTIVE' as const },
  };
  let apiKey = await prisma.apiKey.findFirst({
    where: { tokenHash: v2Hash, ...activeFilter },
  });

  // Lazy migration: 1.x scrypt hashes (salted with API_KEY_SECRET, NEXTAUTH_SECRET
  // or the ENCRYPTION_KEY-derived secret) and 2.0 HMACs signed with
  // NEXTAUTH_SECRET before an independent API_KEY_SECRET was configured.
  if (!apiKey) {
    const legacy = await legacyHashCandidatesWithAdmission(req, token);
    if (legacy.status === 'throttled') return legacy;
    if (legacy.candidates.length > 0) {
      apiKey = await prisma.apiKey.findFirst({
        where: { tokenHash: { in: legacy.candidates }, ...activeFilter },
      });
    }

    if (apiKey) {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: {
          tokenHash: v2Hash,
          lastUsedAt: new Date(),
        },
      });
      return { status: 'ok', key: { ...apiKey, tokenHash: v2Hash } };
    }
  }

  if (!apiKey) return { status: 'invalid' };

  await prisma.apiKey.updateMany({
    where: {
      id: apiKey.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
    },
    data: { lastUsedAt: new Date() },
  });

  return { status: 'ok', key: apiKey };
}

/**
 * Legacy contract: the key, or null. A throttled legacy-hash attempt also yields null (401), so
 * existing callers keep their behaviour; use authenticateApiKeyDetailed to answer 429.
 */
export async function authenticateApiKey(req: NextRequest) {
  const result = await authenticateApiKeyDetailed(req);
  return result.status === 'ok' ? result.key : null;
}

export function hasApiScopes(scopes: string[] | null | undefined, required: string[]) {
  if (!scopes || scopes.length === 0) return false;
  return required.every(scope => scopes.includes(scope));
}
