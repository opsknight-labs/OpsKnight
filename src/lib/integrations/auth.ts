import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { decryptStoredSecret } from '@/lib/encryption';

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Every routing-key value the request carries, in precedence order. Senders such as Pub/Sub push
 * (OIDC JWT) or Datadog OAuth put their own token in Authorization, so the query key must still count.
 */
export function extractIntegrationKeyCandidates(req: NextRequest): string[] {
  const candidates: string[] = [];
  const authHeader = req.headers.get('authorization') || '';
  const lower = authHeader.toLowerCase();

  if (lower.startsWith('bearer ')) {
    candidates.push(authHeader.slice(7).trim());
  } else if (lower.startsWith('token token=')) {
    candidates.push(authHeader.slice('token token='.length).trim());
  }

  const direct = req.headers.get('x-integration-key') || req.headers.get('x-api-key');
  if (direct) candidates.push(direct.trim());

  // Fallback for providers that cannot set headers (e.g., some webhook senders).
  const { searchParams } = new URL(req.url);
  const queryKey =
    searchParams.get('integrationKey') ||
    searchParams.get('integration_key') ||
    searchParams.get('key');
  if (queryKey) candidates.push(queryKey.trim());

  return candidates.filter(Boolean);
}

export function extractIntegrationKey(req: NextRequest): string | null {
  return extractIntegrationKeyCandidates(req)[0] ?? null;
}

export async function isIntegrationAuthorized(
  req: NextRequest,
  expectedKey: string,
  previousKey?: string | null,
  previousKeyExpiresAt?: Date | null
): Promise<boolean> {
  const candidates = extractIntegrationKeyCandidates(req);
  if (candidates.length === 0) return false;
  const [currentValue, previousValue] = await Promise.all([
    decryptStoredSecret(expectedKey),
    previousKey ? decryptStoredSecret(previousKey) : Promise.resolve(null),
  ]);
  const previousActive = Boolean(
    previousValue && previousKeyExpiresAt && previousKeyExpiresAt.getTime() > Date.now()
  );
  return candidates.some(
    provided =>
      safeEqual(provided, currentValue) ||
      (previousActive && safeEqual(provided, previousValue as string))
  );
}

/** Signature secrets accepted now: the current one, plus the previous one during a rotation overlap. */
export async function activeSignatureSecrets(integration: {
  signatureSecret: string | null;
  previousSignatureSecret: string | null;
  previousSignatureSecretExpiresAt: Date | null;
}): Promise<string[]> {
  const stored = [integration.signatureSecret];
  if (
    integration.previousSignatureSecretExpiresAt &&
    integration.previousSignatureSecretExpiresAt.getTime() > Date.now()
  ) {
    stored.push(integration.previousSignatureSecret);
  }
  return Promise.all(stored.filter((s): s is string => !!s).map(decryptStoredSecret));
}
