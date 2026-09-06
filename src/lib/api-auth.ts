import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyScryptTokens, hashLegacyV2Tokens, hashTokenV2 } from '@/lib/api-keys';

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

  // Lazy migration: releases before API_KEY_SECRET became a production
  // boundary could write V2 HMACs directly from NEXTAUTH_SECRET. Accept those
  // hashes once and immediately migrate them to the current API-key secret.
  if (!apiKey) {
    const legacyV2Hashes = hashLegacyV2Tokens(token);
    if (legacyV2Hashes.length > 0) {
      apiKey = await prisma.apiKey.findFirst({
        where: { tokenHash: { in: legacyV2Hashes }, ...activeFilter },
      });
    }
  }

  // Older releases used scrypt for lookup hashes. Check every compatible
  // historical secret basis, then migrate successful matches to V2 HMAC.
  if (!apiKey) {
    const legacyScryptHashes = await hashLegacyScryptTokens(token);
    apiKey = await prisma.apiKey.findFirst({
      where: { tokenHash: { in: legacyScryptHashes }, ...activeFilter },
    });
  }

  if (!apiKey) return null;

  if (apiKey.tokenHash !== v2Hash) {
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        tokenHash: v2Hash,
        lastUsedAt: new Date(),
      },
    });
    return apiKey;
  }

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
