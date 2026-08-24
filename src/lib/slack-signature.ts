/**
 * Slack request signature verification.
 *
 * The signing secret is resolved from the encrypted `signingSecret` on
 * SlackOAuthConfig — entered once in Settings > Slack, alongside the client
 * secret — with SLACK_SIGNING_SECRET as an optional env override.
 *
 * It deliberately does NOT come from SlackIntegration.signingSecret: the OAuth
 * callback used to populate that column with `authed_user.id`, the Slack user ID
 * of whoever installed the app. Slack never returns a signing secret from OAuth,
 * so no install can supply one.
 *
 * Verification fails closed. When no secret can be resolved, requests are
 * rejected rather than trusted — an unverified `/api/slack/*` endpoint lets
 * anyone who can reach the URL acknowledge, resolve and reassign incidents.
 */

import crypto from 'crypto';
import prisma from './prisma';
import { logger } from './logger';
import { decrypt } from './encryption';

/** Slack rejects its own replays past 5 minutes; mirror that here. */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/** Short TTL so a re-install is picked up quickly without a DB read per event. */
const SECRET_CACHE_TTL_MS = 60_000;

let cachedSecret: { value: string; expiresAt: number } | null = null;

/** Test seam — clears the memoised secret. */
export function resetSigningSecretCache(): void {
  cachedSecret = null;
}

/**
 * Resolve the Slack signing secret, preferring the environment variable and
 * falling back to the encrypted secret on the enabled Slack integration.
 * Returns null when neither source yields a usable secret.
 */
export async function getSlackSigningSecret(): Promise<string | null> {
  const fromEnv = process.env.SLACK_SIGNING_SECRET?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (cachedSecret && cachedSecret.expiresAt > Date.now()) {
    return cachedSecret.value;
  }

  try {
    const config = await prisma.slackOAuthConfig.findFirst({
      where: { NOT: { signingSecret: null } },
      orderBy: { updatedAt: 'desc' },
      select: { signingSecret: true },
    });

    if (!config?.signingSecret) {
      return null;
    }

    const decrypted = (await decrypt(config.signingSecret)).trim();
    if (!decrypted) {
      return null;
    }

    cachedSecret = { value: decrypted, expiresAt: Date.now() + SECRET_CACHE_TTL_MS };
    return decrypted;
  } catch (error) {
    logger.error('[Slack] Failed to load signing secret from Slack OAuth config', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Slack delivers interactive payloads with a `response_url` the app may POST
 * back to. It arrives in the request body, so it is attacker-controlled input:
 * fetching it unchecked is a server-side request forgery primitive that can be
 * aimed at internal services or the cloud metadata endpoint.
 *
 * Slack only ever issues these on hooks.slack.com over HTTPS.
 */
const SLACK_RESPONSE_ORIGIN = 'https://hooks.slack.com';

/** /actions/<team>/<request>/<token> — alphanumeric segments only. */
const SLACK_RESPONSE_PATH = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){1,5}$/;

export function isTrustedSlackResponseUrl(value: unknown): value is string {
  return toSlackResponseUrl(value) !== null;
}

/**
 * Validate a `response_url` and rebuild it against a literal origin.
 *
 * Returning a reconstructed URL rather than the caller's string is deliberate:
 * the host is a compile-time constant, so no attacker-controlled value can
 * influence which server is contacted, only the path beneath Slack's own host.
 * A boolean-only guard leaves the tainted string flowing into fetch(), which is
 * both weaker and unprovable to static analysis.
 *
 * Returns null when the value is not an HTTPS Slack hooks URL.
 */
export function toSlackResponseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'hooks.slack.com') {
    return null;
  }

  // Slack response URLs are /actions/<team>/<request>/<token> — plain
  // alphanumeric segments. Requiring that shape means nothing from the request
  // body reaches fetch() except characters matched by this literal pattern, and
  // the query string is dropped entirely since Slack never sets one.
  if (!SLACK_RESPONSE_PATH.test(parsed.pathname)) {
    return null;
  }

  // Origin is a compile-time constant, so the destination host cannot be
  // influenced; only the validated path below it varies.
  return `${SLACK_RESPONSE_ORIGIN}${parsed.pathname}`;
}

export type SignatureFailure = 'no_secret' | 'missing_headers' | 'stale_timestamp' | 'mismatch';

export type SignatureResult = { valid: true } | { valid: false; reason: SignatureFailure };

const SEEN_SIGNATURES = new Map<string, number>();

function cleanSeenSignatures() {
  const now = Date.now();
  for (const [sig, expiry] of SEEN_SIGNATURES.entries()) {
    if (expiry <= now) {
      SEEN_SIGNATURES.delete(sig);
    }
  }
}

export function resetSlackSignatureReplayCache(): void {
  SEEN_SIGNATURES.clear();
}

/**
 * Verify an inbound Slack request signature against the raw request body.
 */
export async function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string
): Promise<SignatureResult> {
  const secret = await getSlackSigningSecret();

  if (!secret) {
    logger.error(
      '[Slack] Rejecting request: no signing secret configured. Add it under ' +
        'Settings > Integrations > Slack (Slack app > Basic Information > Signing Secret). ' +
        'Reconnecting Slack does not supply it — OAuth never returns a signing secret.'
    );
    return { valid: false, reason: 'no_secret' };
  }

  if (!signature || !timestamp) {
    return { valid: false, reason: 'missing_headers' };
  }

  if (process.env.NODE_ENV !== 'test') {
    cleanSeenSignatures();
    if (SEEN_SIGNATURES.has(signature)) {
      logger.warn('[Slack] Rejecting replayed request signature');
      return { valid: false, reason: 'mismatch' };
    }
  }

  const requestTime = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(requestTime)) {
    return { valid: false, reason: 'missing_headers' };
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - requestTime);
  if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const computed =
    'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');

  try {
    // timingSafeEqual throws on length mismatch — a malformed signature is invalid, not an error
    const matches = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
    if (matches) {
      SEEN_SIGNATURES.set(signature, Date.now() + MAX_TIMESTAMP_SKEW_SECONDS * 1000);
      return { valid: true };
    }
    return { valid: false, reason: 'mismatch' };
  } catch {
    return { valid: false, reason: 'mismatch' };
  }
}
