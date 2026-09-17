/**
 * Isolated Status-Only Authentication
 *
 * Provides cryptographically signed, short-lived authorization tickets and
 * host-bound status session tokens. These tokens only grant STATUS_PAGE_VIEW
 * capability for a specific status page and contain zero administrative or
 * application-plane privileges.
 */

import { getNextAuthSecret } from '@/lib/secret-manager';
import { useSecureCookies } from '@/lib/auth-cookies';

export const STATUS_SESSION_COOKIE_NAME = useSecureCookies
  ? '__Host-opsknight-status-session'
  : 'opsknight-status-session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

async function getHmacKey() {
  const secret = await getNextAuthSecret();
  if (!secret) {
    throw new Error('Status page authentication requires the application secret.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`status-auth:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export interface StatusAuthTicketPayload {
  pageId: string;
  targetHost: string;
  returnTo: string;
  userId?: string;
  exp: number;
  nonce: string;
}

export interface StatusSessionPayload {
  pageId: string;
  userId?: string;
  exp: number;
  iat: number;
}

/**
 * Sign a short-lived authorization ticket (TTL ~60s) for the redirect from
 * the canonical app to the status domain callback.
 */
export async function createStatusAuthTicket(params: {
  pageId: string;
  targetHost: string;
  returnTo: string;
  userId?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const key = await getHmacKey();
  const exp = Date.now() + (params.ttlSeconds ?? 60) * 1000;
  const payload: StatusAuthTicketPayload = {
    pageId: params.pageId,
    targetHost: params.targetHost.trim().toLowerCase().split(':')[0] ?? '',
    returnTo: params.returnTo,
    userId: params.userId,
    exp,
    nonce: crypto.randomUUID(),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = encoder.encode(payloadJson);
  const data = base64UrlEncode(payloadBytes);

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sig = base64UrlEncode(new Uint8Array(signature));

  return `${data}.${sig}`;
}

const consumedTicketNonces = new Map<string, number>();

function pruneExpiredTicketNonces() {
  const now = Date.now();
  for (const [nonce, exp] of consumedTicketNonces.entries()) {
    if (exp < now) {
      consumedTicketNonces.delete(nonce);
    }
  }
}

/**
 * Verify and unpack an authorization ticket on the status domain callback.
 * Enforces cryptographic signature, host binding, expiration, and process-local
 * replay mitigation within the 60-second TTL window.
 */
export async function verifyStatusAuthTicket(
  ticket: string,
  expectedPageId: string,
  currentHost: string
): Promise<StatusAuthTicketPayload | null> {
  try {
    const parts = ticket.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const key = await getHmacKey();

    const sigBytes = base64UrlDecode(sig);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as unknown as BufferSource,
      encoder.encode(data)
    );
    if (!valid) return null;

    const payloadBytes = base64UrlDecode(data);
    const payload = JSON.parse(decoder.decode(payloadBytes)) as StatusAuthTicketPayload;

    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }
    if (payload.pageId !== expectedPageId) {
      return null;
    }
    const cleanHost = currentHost.trim().toLowerCase().split(':')[0] ?? '';
    if (payload.targetHost && payload.targetHost !== cleanHost) {
      return null;
    }

    if (!payload.nonce || typeof payload.nonce !== 'string') {
      return null;
    }

    // Process-local replay mitigation: reject immediate replayed tickets within this instance's TTL window
    pruneExpiredTicketNonces();
    if (consumedTicketNonces.has(payload.nonce)) {
      return null;
    }
    consumedTicketNonces.set(payload.nonce, payload.exp);

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a signed status-only session token (TTL ~24 hours).
 */
export async function createStatusSessionToken(
  pageId: string,
  userId?: string,
  ttlHours = 24
): Promise<string> {
  const key = await getHmacKey();
  const now = Date.now();
  const exp = now + ttlHours * 60 * 60 * 1000;
  const payload: StatusSessionPayload = {
    pageId,
    userId,
    exp,
    iat: now,
  };

  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const data = base64UrlEncode(payloadBytes);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sig = base64UrlEncode(new Uint8Array(signature));

  return `${data}.${sig}`;
}

/**
 * Verify a status-only session token for a given pageId.
 */
export async function verifyStatusSessionToken(
  token?: string | null,
  expectedPageId?: string | null
): Promise<StatusSessionPayload | null> {
  if (!token || !expectedPageId) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const key = await getHmacKey();

    const sigBytes = base64UrlDecode(sig);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as unknown as BufferSource,
      encoder.encode(data)
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(data))) as StatusSessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }
    if (payload.pageId !== expectedPageId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify if request has access to a private status page.
 * Checks for dedicated status session token first. If on app host, also accepts
 * valid NextAuth session.
 */
export async function hasStatusPageAccess(params: {
  pageId: string;
  statusSessionCookie?: string | null;
  isAppHost?: boolean;
  hasAppSession?: boolean;
}): Promise<boolean> {
  if (params.statusSessionCookie) {
    const valid = await verifyStatusSessionToken(params.statusSessionCookie, params.pageId);
    if (valid) return true;
  }
  if (params.isAppHost && params.hasAppSession) {
    return true;
  }
  return false;
}

export function extractStatusSessionToken(cookieHeader?: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:__Host-opsknight-status-session|opsknight-status-session)=([^;]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function isRequestToAppHost(hostHeader?: string | null, appUrl?: string | null): boolean {
  if (!hostHeader) return true;
  const cleanHost = hostHeader.trim().toLowerCase().split(':')[0] ?? '';
  if (
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === '[::1]' ||
    cleanHost.endsWith('.localhost')
  ) {
    return true;
  }
  if (appUrl) {
    try {
      const appHost = new URL(appUrl).host.trim().toLowerCase().split(':')[0] ?? '';
      if (appHost && cleanHost === appHost) return true;
    } catch {}
  }
  const envAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
  if (envAppUrl) {
    try {
      const envHost = new URL(envAppUrl).host.trim().toLowerCase().split(':')[0] ?? '';
      if (envHost && cleanHost === envHost) return true;
    } catch {}
  }
  return false;
}
