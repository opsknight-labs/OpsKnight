/**
 * Secret Manager - Auto-generates and stores NEXTAUTH_SECRET
 *
 * This module eliminates the need for users to manually configure NEXTAUTH_SECRET
 * by auto-generating one on first run and storing it in the database.
 *
 * EDGE RUNTIME COMPATIBILITY NOTE:
 * This file is used by middleware.ts which runs on Edge Runtime.
 * Standard Prisma Client DOES NOT work on Edge Runtime.
 * Therefore, we have removed the database fallback for this specific module.
 *
 * Priority order:
 * 1. Environment variable NEXTAUTH_SECRET (Recommended for Production)
 * 2. Generate new ephemeral secret (Development/Fallback - Invalidates on restart)
 */

import { logger } from './logger';

// Use globalThis.crypto for Edge Runtime compatibility
function generateRandomBase64(length: number): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const array = new Uint8Array(length);
    globalThis.crypto.getRandomValues(array);
    // Use Buffer if available (Next.js Edge supports it), otherwise perform manual conversion
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(array).toString('base64');
    }
    // Fallback for environments without Buffer but with crypto (unlikely in Next.js context but safe)
    let binary = '';
    for (let i = 0; i < length; i++) {
      binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
  }

  // Fallback for Node.js environments where global crypto might be missing (unlikely in strict mode but good for safety)
  // We use dynamic require to avoid static analysis picking up 'crypto' in Edge
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require('crypto');
    return randomBytes(length).toString('base64');
  } catch (_e) {
    // Should not happen in standard envs
    throw new Error('No crypto implementation available');
  }
}

// In-memory cache
let cachedSecret: string | null = null;

/**
 * Generates a cryptographically secure random secret
 */
function generateSecret(): string {
  return generateRandomBase64(32);
}

/**
 * Why this changed: the ephemeral-secret fallback silently broke
 * sessions in production. NextAuth runs in two separate runtimes —
 * Node (auth API routes) and Edge (middleware) — each with its own
 * module instance and therefore its own `cachedSecret`. If
 * NEXTAUTH_SECRET is absent, the Node runtime mints JWTs with secret
 * A while middleware tries to verify them with secret B, and every
 * navigation past `/` 302s back to `/login`. The user looks logged
 * in (page-level `getServerSession` works in Node) but middleware
 * disagrees on every other route.
 *
 * Fix: when NODE_ENV === 'production', refuse to fall back. Throw
 * loudly so the deploy fails immediately instead of shipping a broken
 * session layer. Dev and test still get the auto-generated secret so
 * `npm run dev` works without configuration.
 */

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

const MISSING_SECRET_MESSAGE =
  'NEXTAUTH_SECRET is not set. In production this is a fatal misconfiguration: NextAuth runs in two ' +
  'runtimes (Node for API routes, Edge for middleware), each generating its own ' +
  'ephemeral secret if none is provided — so JWTs minted in one runtime cannot be ' +
  'verified in the other, and every navigation past `/` redirects back to /login. ' +
  'Set NEXTAUTH_SECRET to a stable value (e.g., `openssl rand -base64 32`).';

/**
 * Get the NextAuth secret.
 *
 * Priority chain:
 *   1. `NEXTAUTH_SECRET` env var — explicit, recommended.
 *   2. Production without it → throw. Authentication and encryption keys
 *      deliberately remain separate cryptographic domains.
 *   3. Dev/test → in-memory ephemeral generation, with a warn.
 */
export async function getNextAuthSecret(): Promise<string> {
  const envSecret = process.env.NEXTAUTH_SECRET;
  if (envSecret) {
    return envSecret;
  }

  if (isProduction()) {
    logger.error('[SecretManager] ' + MISSING_SECRET_MESSAGE);
    throw new Error('[SecretManager] ' + MISSING_SECRET_MESSAGE);
  }

  if (cachedSecret) {
    return cachedSecret;
  }

  logger.warn(
    '[SecretManager] NEXTAUTH_SECRET missing; generating an ephemeral secret. ' +
      'This is OK for `npm run dev` but will break sessions on restart. ' +
      'Set NEXTAUTH_SECRET in `.env` to keep sessions stable.'
  );
  cachedSecret = generateSecret();
  return cachedSecret;
}

/**
 * Synchronous version. Same priority chain except the ENCRYPTION_KEY
 * derivation is sync-only (the cache must already be warm from a prior
 * async call). Used where async isn't possible.
 *
 * For the rolling-deploy + middleware case the cache priming happens at
 * the first authenticated request; this sync path is mostly a legacy
 * surface kept for compatibility.
 */
export function getNextAuthSecretSync(): string {
  const envSecret = process.env.NEXTAUTH_SECRET;
  if (envSecret) {
    return envSecret;
  }

  if (isProduction()) {
    logger.error('[SecretManager] ' + MISSING_SECRET_MESSAGE);
    throw new Error('[SecretManager] ' + MISSING_SECRET_MESSAGE);
  }

  if (cachedSecret) {
    return cachedSecret;
  }

  logger.warn(
    '[SecretManager] getNextAuthSecretSync called without env var or cache; generating ephemeral.'
  );
  cachedSecret = generateSecret();
  return cachedSecret;
}
