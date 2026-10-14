import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyTokenCandidates, hashTokenV2, isLegacy1xTokenShape } from '@/lib/api-keys';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { getClientIp } from '@/lib/client-ip';
import { authCache } from './cache';
import { checkLegacyTokenAdmission } from './rate-limit';

export { hashTokenV2 } from '@/lib/api-keys';


export interface V2ApiKeyIdentity {
  id: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: string[];
  userId: string;
  isServiceAccount: boolean;
}

export interface V2AuthContext {
  apiKey: V2ApiKeyIdentity;
  actor: AuthorizationActor;
}

function extractToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (authHeader.toLowerCase().startsWith('api-key ')) {
    return authHeader.slice(8).trim();
  }
  const directHeader = req.headers.get('x-api-key');
  if (directHeader) {
    return directHeader.trim();
  }
  return null;
}

export async function authenticateV2Request(req: NextRequest): Promise<V2AuthContext> {
  const token = extractToken(req);
  if (!token) {
    throw new AppError({
      code: 'AUTHENTICATION_REQUIRED',
      userMessage: 'Authentication credentials are required. Provide a valid Bearer token.',
    });
  }

  const v2Hash = hashTokenV2(token);
  const negativeCacheKey = `v2:invalid-token:${v2Hash}`;
  if (authCache.get(negativeCacheKey)) {
    throw new AppError({
      code: 'API_KEY_INVALID',
      userMessage: 'The provided API key or service account token is invalid, expired, or revoked.',
    });
  }

  const activeFilter = {

    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    user: { status: 'ACTIVE' as const },
  };

  let apiKeyRecord = await prisma.apiKey.findFirst({
    where: { tokenHash: v2Hash, ...activeFilter },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          department: true,
          jobTitle: true,
          email: true,
          teamMemberships: { select: { teamId: true } },
        },
      },
    },
  });

  // Check legacy hash migration fallback if not found
  if (!apiKeyRecord) {
    // Shield CPU & event loop from expensive scrypt operations under invalid token bursts
    if (isLegacy1xTokenShape(token)) {
      const clientIp = getClientIp(req.headers);
      const admitted = await checkLegacyTokenAdmission(clientIp);
      if (!admitted) {
        throw new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage: 'Too many invalid token authentication attempts from this IP address. Please wait before retrying.',
        });
      }
    }

    const legacyCandidates = await hashLegacyTokenCandidates(token);
    if (legacyCandidates.length > 0) {
      apiKeyRecord = await prisma.apiKey.findFirst({
        where: { tokenHash: { in: legacyCandidates }, ...activeFilter },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              status: true,
              department: true,
              jobTitle: true,
              email: true,
              teamMemberships: { select: { teamId: true } },
            },
          },
        },
      });

      if (apiKeyRecord) {
        // Transparent lazy upgrade to V2 hash
        await prisma.apiKey.update({
          where: { id: apiKeyRecord.id },
          data: { tokenHash: v2Hash, lastUsedAt: new Date() },
        });
      }
    }
  }

  if (!apiKeyRecord || !apiKeyRecord.user) {
    authCache.set(negativeCacheKey, true, 30_000);
    throw new AppError({
      code: 'API_KEY_INVALID',
      userMessage: 'The provided API key or service account token is invalid, expired, or revoked.',
    });
  }

  const user = apiKeyRecord.user;
  const actor = authorizationActorFromUser(user);
  if (!actor) {
    throw new AppError({
      code: 'API_KEY_USER_INVALID',
      userMessage: 'The user or service account associated with this token is not active.',
    });
  }

  const isServiceAccount =
    user.department === 'SERVICE_ACCOUNT' ||
    user.jobTitle === 'Service Account' ||
    user.email.includes('@serviceaccount.');

  const apiKeyIdentity: V2ApiKeyIdentity = {
    id: apiKeyRecord.id,
    name: apiKeyRecord.name,
    prefix: apiKeyRecord.prefix,
    tokenHash: v2Hash,
    scopes: apiKeyRecord.scopes,
    userId: user.id,
    isServiceAccount,
  };

  const fullActor: AuthorizationActor = {
    ...actor,
    apiKey: { id: apiKeyRecord.id, scopes: apiKeyRecord.scopes },
  };

  const authContext: V2AuthContext = {
    apiKey: apiKeyIdentity,
    actor: fullActor,
  };

  // Debounced lastUsedAt update (at most once every 5 minutes in background)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
  if (!apiKeyRecord.lastUsedAt || apiKeyRecord.lastUsedAt < fiveMinutesAgo) {
    prisma.apiKey
      .update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
  }

  return authContext;
}

export function invalidateV2AuthCache(tokenHash?: string): void {
  if (tokenHash) {
    authCache.delete(tokenHash);
  } else {
    authCache.clear();
  }
}

