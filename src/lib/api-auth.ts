import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashTokenV1, hashTokenV2 } from '@/lib/api-keys';

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
  let apiKey = await prisma.apiKey.findFirst({
    where: { tokenHash: v2Hash, revokedAt: null, user: { status: 'ACTIVE' } },
  });

  // Lazy migration: Check legacy hash if V2 not found
  if (!apiKey) {
    const v1Hash = hashTokenV1(token);
    apiKey = await prisma.apiKey.findFirst({
      where: { tokenHash: v1Hash, revokedAt: null, user: { status: 'ACTIVE' } },
    });

    if (apiKey) {
      // Found with legacy hash - migrate to secure HMAC hash immediately
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: {
          tokenHash: v2Hash,
          lastUsedAt: new Date(),
        },
      });
      return apiKey;
    }
  }

  if (!apiKey) return null;

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return apiKey;
}

export function hasApiScopes(scopes: string[] | null | undefined, required: string[]) {
  if (!scopes || scopes.length === 0) return false;
  return required.every(scope => scopes.includes(scope));
}
