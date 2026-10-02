import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyTokenCandidates, hashTokenV2 } from '@/lib/api-keys';

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

export async function authenticateApiKey(req: NextRequest) {
  const token = extractApiKey(req);
  if (!token) return null;

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
    const legacyHashes = await hashLegacyTokenCandidates(token);
    if (legacyHashes.length > 0) {
      apiKey = await prisma.apiKey.findFirst({
        where: { tokenHash: { in: legacyHashes }, ...activeFilter },
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
      return { ...apiKey, tokenHash: v2Hash };
    }
  }

  if (!apiKey) return null;

  await prisma.apiKey.updateMany({
    where: {
      id: apiKey.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
    },
    data: { lastUsedAt: new Date() },
  });

  return apiKey;
}

export function hasApiScopes(scopes: string[] | null | undefined, required: string[]) {
  if (!scopes || scopes.length === 0) return false;
  return required.every(scope => scopes.includes(scope));
}
