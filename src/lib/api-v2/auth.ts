import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashLegacyTokenCandidates, hashTokenV2, isLegacy1xTokenShape } from '@/lib/api-keys';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { getClientIp } from '@/lib/client-ip';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import { recordAuthFailure } from './observability';
import { isServiceAccountIdentity } from '@/lib/service-account-identity';
import { authCache } from './cache';
import {
  acquireLegacyScryptSlot,
  acquireOverBudgetIpSlot,
  acquireVerificationSlot,
  checkLegacyTokenAdmission,
  isFailedAuthAdmissionBlocked,
  legacyAdmissionRetryAfterSeconds,
  recordFailedAuthAttempt,
} from './rate-limit';

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

// Every token OpsKnight issues is `ok_` followed by URL-safe base64. Anything
// else cannot match a stored hash, so reject it before spending database work.
const MAX_TOKEN_LENGTH = 256;
const WELL_FORMED_TOKEN_PATTERN = /^ok_[A-Za-z0-9_-]{16,}$/;

export function isWellFormedApiToken(token: string): boolean {
  return token.length <= MAX_TOKEN_LENGTH && WELL_FORMED_TOKEN_PATTERN.test(token);
}

const INVALID_TOKEN_MESSAGE =
  'The provided API key or service account token is invalid, expired, or revoked.';

export async function authenticateV2Request(req: NextRequest): Promise<V2AuthContext> {
  const token = extractToken(req);
  if (!token) {
    recordAuthFailure('missing_credentials');
    throw new AppError({
      code: 'AUTHENTICATION_REQUIRED',
      userMessage: 'Authentication credentials are required. Provide a valid Bearer token.',
    });
  }

  const v2Hash = hashTokenV2(token);

  // 1. Negative memory cache (0 DB queries on repeated invalid calls)
  const negativeCacheKey = `v2:invalid-token:${v2Hash}`;
  if (authCache.get(negativeCacheKey)) {
    recordAuthFailure('invalid_token');
    throw new AppError({
      code: 'API_KEY_INVALID',
      userMessage: 'The provided API key or service account token is invalid, expired, or revoked.',
    });
  }

  // 2. Reject tokens that cannot possibly be valid before any database work.
  const clientIp = getClientIp(req);
  if (!isWellFormedApiToken(token)) {
    recordAuthFailure('malformed_token');
    await recordFailedAuthAttempt(clientIp);
    throw new AppError({ code: 'API_KEY_INVALID', userMessage: INVALID_TOKEN_MESSAGE });
  }

  // 3. Bound verification work. An IP over its failed-auth budget is throttled to a small
  // concurrency allowance rather than refused, so a valid credential sharing that address
  // (a corporate NAT) keeps working while the abuse stays bounded. Unidentified clients get
  // their own bounded lane.
  const overBudget = await isFailedAuthAdmissionBlocked(clientIp);
  let releaseIpSlot = () => {};
  if (overBudget) {
    try {
      releaseIpSlot = acquireOverBudgetIpSlot(clientIp);
    } catch (error) {
      recordAuthFailure('ip_throttled');
      throw error;
    }
  }
  let releaseSlot = () => {};
  try {
    try {
      releaseSlot = await acquireVerificationSlot(clientIp);
    } catch (error) {
      recordAuthFailure('verification_busy');
      throw error;
    }
    return await verifyTokenAgainstDatabase(token, v2Hash, clientIp, negativeCacheKey);
  } finally {
    releaseSlot();
    releaseIpSlot();
  }
}

async function verifyTokenAgainstDatabase(
  token: string,
  v2Hash: string,
  clientIp: string,
  negativeCacheKey: string
): Promise<V2AuthContext> {
  const activeFilter = {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    user: { status: 'ACTIVE' as const },
  };

  const lookupStartedAt = performance.now();
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

  observeOperationalHistogram(
    'opsknight_api_v2_auth_lookup_duration_seconds',
    (performance.now() - lookupStartedAt) / 1000
  );

  // Check legacy hash migration fallback if not found
  if (!apiKeyRecord) {
    // Shield CPU & event loop from expensive scrypt operations under invalid token bursts
    if (isLegacy1xTokenShape(token)) {
      const legacyAdmitted = await checkLegacyTokenAdmission(clientIp);
      if (!legacyAdmitted) {
        recordAuthFailure('legacy_throttled');
        throw new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage:
            'Too many legacy token authentication attempts. Please wait before retrying.',
          details: { retryAfter: legacyAdmissionRetryAfterSeconds() },
        });
      }
    }

    let legacyCandidates: string[];
    let releaseScrypt: () => void = () => {};
    if (isLegacy1xTokenShape(token)) {
      try {
        releaseScrypt = acquireLegacyScryptSlot();
      } catch (error) {
        recordAuthFailure('legacy_throttled');
        throw error;
      }
    }
    try {
      legacyCandidates = await hashLegacyTokenCandidates(token);
    } finally {
      releaseScrypt();
    }
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
    recordAuthFailure('invalid_token');
    authCache.set(negativeCacheKey, true, 30_000);
    await recordFailedAuthAttempt(clientIp);
    throw new AppError({
      code: 'API_KEY_INVALID',
      userMessage: 'The provided API key or service account token is invalid, expired, or revoked.',
    });
  }

  const user = apiKeyRecord.user;
  const actor = authorizationActorFromUser(user);
  if (!actor) {
    recordAuthFailure('inactive_principal');
    authCache.set(negativeCacheKey, true, 30_000);
    await recordFailedAuthAttempt(clientIp);
    throw new AppError({
      code: 'API_KEY_USER_INVALID',
      userMessage: 'The user or service account associated with this token is not active.',
    });
  }

  const isServiceAccount = isServiceAccountIdentity(user);

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
    authCache.delete(`v2:invalid-token:${tokenHash}`);
    authCache.delete(tokenHash);
  } else {
    authCache.clear();
  }
}
