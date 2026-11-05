import { randomBytes, randomInt } from 'node:crypto';
import type { McpClient, McpPolicy, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incrementSharedCounter } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { digestMcpSecret } from './config';
import { effectiveMcpClientScopes } from './client-policy';
import { createMcpOAuthModel } from './oauth-model';
import { MCP_ABSOLUTE_SESSION_DAYS } from './session-lifetime';

/**
 * OAuth 2.0 device authorization grant (RFC 8628) for CLIs, SSH sessions and headless servers.
 * The device shows a short user code; the person enters it on /oauth/mcp/device in any browser,
 * reviews the same consent as the browser flow and approves. The device polls the token endpoint
 * and receives the same grant and tokens as the authorization-code flow, exactly once.
 */
export const MCP_DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** How long a device sign-in may wait for the person (RFC 8628 §3.2 expires_in). */
export const MCP_DEVICE_CODE_TTL_SECONDS = 600;
/** The minimum wait between polls; every too-fast poll raises it by the step (§3.5 slow_down). */
export const MCP_DEVICE_POLL_INTERVAL_SECONDS = 5;
export const MCP_DEVICE_SLOW_DOWN_STEP_SECONDS = 5;
export const MCP_DEVICE_MAX_INTERVAL_SECONDS = 60;
/** Wrong codes one person, or one network address, may enter before code entry locks. */
export const MCP_DEVICE_WRONG_CODE_LIMIT = 5;
export const MCP_DEVICE_LOCK_WINDOW_MS = 15 * 60_000;
export const MCP_DEVICE_ACCESS_TOKEN_SECONDS = 300;

/**
 * Consonants only (RFC 8628 §6.1): no vowels, so no words are spelled, and nothing that reads
 * like a digit (no I, O, U, Y). 20^8 ≈ 2.6 × 10^10 codes, of which only a few are live at once.
 */
export const MCP_USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;
const USER_CODE_PATTERN = new RegExp(`^[${MCP_USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`);

/** A new user code in display form, XXXX-XXXX. */
export function newMcpUserCode() {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++)
    code += MCP_USER_CODE_ALPHABET.charAt(randomInt(MCP_USER_CODE_ALPHABET.length));
  return formatMcpUserCode(code);
}

/** XXXXXXXX → XXXX-XXXX. */
export function formatMcpUserCode(normalized: string) {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/**
 * The canonical form of what a person typed: case, spaces and dashes do not matter. Null when it
 * cannot be a user code at all.
 */
export function normalizeMcpUserCode(input: string): string | null {
  if (input.length > 32) return null;
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return USER_CODE_PATTERN.test(compact) ? compact : null;
}

/** Keyed digests, with a purpose prefix so a user code can never match any other credential. */
export function mcpUserCodeDigest(normalizedUserCode: string) {
  return digestMcpSecret(`device-user-code:${normalizedUserCode}`);
}
export function mcpDeviceCodeDigest(deviceCode: string) {
  return digestMcpSecret(`device-code:${deviceCode}`);
}
/** 256 bits; the device keeps it and only its digest is stored. */
export function newMcpDeviceCode() {
  return randomBytes(32).toString('base64url');
}

/**
 * The scopes a client may obtain through the device flow, or null when it may not use it: the
 * client must be registered for the grant (dynamic registration declared it, or the administrator
 * ticked it), not revoked, and not a metadata-document client.
 */
export function mcpDeviceClientCeiling(
  client: Pick<
    McpClient,
    'metadataUrl' | 'scopes' | 'dynamicRegistration' | 'revokedAt' | 'deviceCodeGrant'
  > | null,
  policy: McpPolicy | null
): string[] | null {
  if (!client || client.revokedAt || !client.deviceCodeGrant || client.metadataUrl) return null;
  const ceiling = effectiveMcpClientScopes(client, policy);
  return ceiling?.length ? ceiling : null;
}

const lockWindow = () => Math.floor(Date.now() / MCP_DEVICE_LOCK_WINDOW_MS);
const lockKeys = (keys: readonly string[]) => keys.map(key => `${key}:${lockWindow()}`);

/** True once any of the keys (the person, their network address) used up its wrong codes. */
export async function mcpDeviceEntryLocked(keys: readonly string[]) {
  const rows = await prisma.rateLimit.findMany({
    where: { key: { in: lockKeys(keys) } },
    select: { count: true },
  });
  return rows.some(row => row.count >= MCP_DEVICE_WRONG_CODE_LIMIT);
}

/** Counts one wrong code against every key. */
export async function recordMcpDeviceWrongCode(keys: readonly string[]) {
  for (const key of keys) await incrementSharedCounter(key, MCP_DEVICE_LOCK_WINDOW_MS);
}

export type McpDevicePollError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  | 'invalid_client';

export type McpDevicePollResult =
  | { ok: false; error: McpDevicePollError; interval?: number }
  | {
      ok: true;
      body: {
        access_token: string;
        token_type: 'Bearer';
        expires_in: number;
        refresh_token: string;
        scope: string;
      };
    };

/**
 * One token-endpoint poll (RFC 8628 §3.4-3.5). Run it in a serializable transaction: every state
 * change is a conditional update, so two polls at once can never both receive tokens. Errors that
 * must persist a change (slow_down, expiry) are returned rather than thrown, so the transaction
 * commits them.
 */
export async function pollMcpDeviceAuthorization(
  tx: Prisma.TransactionClient,
  input: { deviceCode: string; clientId: string },
  now = new Date()
): Promise<McpDevicePollResult> {
  const row = await tx.mcpDeviceAuthorization.findUnique({
    where: { deviceCodeHash: mcpDeviceCodeDigest(input.deviceCode) },
  });
  // A device code is bound to the client that requested it.
  if (!row || row.clientId !== input.clientId) return { ok: false, error: 'invalid_grant' };
  if (row.status === 'CONSUMED' || row.status === 'EXPIRED')
    return { ok: false, error: row.status === 'EXPIRED' ? 'expired_token' : 'invalid_grant' };
  const client = await tx.mcpClient.findUnique({ where: { id: row.clientId } });
  if (!client || client.revokedAt || !client.deviceCodeGrant)
    return { ok: false, error: 'invalid_client' };
  if (row.expiresAt <= now) {
    const expired = await tx.mcpDeviceAuthorization.updateMany({
      where: { id: row.id, status: { in: ['PENDING', 'APPROVED', 'DENIED'] } },
      data: { status: 'EXPIRED' },
    });
    // An approval the device never collected leaves no live, unused credential behind.
    if (expired.count === 1 && row.grantId)
      await tx.mcpGrant.updateMany({
        where: { id: row.grantId, revokedAt: null, tokens: { none: {} } },
        data: { revokedAt: now },
      });
    return { ok: false, error: 'expired_token' };
  }
  if (row.status === 'DENIED') return { ok: false, error: 'access_denied' };
  if (row.status === 'PENDING') {
    const tooFast =
      row.lastPolledAt !== null && now.getTime() - row.lastPolledAt.getTime() < row.interval * 1000;
    const interval = tooFast
      ? Math.min(row.interval + MCP_DEVICE_SLOW_DOWN_STEP_SECONDS, MCP_DEVICE_MAX_INTERVAL_SECONDS)
      : row.interval;
    await tx.mcpDeviceAuthorization.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { lastPolledAt: now, interval },
    });
    return tooFast
      ? { ok: false, error: 'slow_down', interval }
      : { ok: false, error: 'authorization_pending' };
  }
  // APPROVED: the one conditional transition that may issue tokens.
  if (!row.grantId || !row.userId) return { ok: false, error: 'invalid_grant' };
  const consumed = await tx.mcpDeviceAuthorization.updateMany({
    where: { id: row.id, status: 'APPROVED', expiresAt: { gt: now } },
    data: { status: 'CONSUMED', consumedAt: now, lastPolledAt: now },
  });
  if (consumed.count !== 1) return { ok: false, error: 'invalid_grant' };
  const model = createMcpOAuthModel(tx, () => {});
  const oauthClient = await model.getClient(client.id, '');
  if (!oauthClient) return { ok: false, error: 'invalid_client' };
  const user = { id: row.userId, grantId: row.grantId };
  const accessToken = await model.generateAccessToken!(oauthClient, user, row.approvedScopes);
  const refreshToken = await model.generateRefreshToken!(oauthClient, user, row.approvedScopes);
  // saveToken re-validates the grant (revocation, security events, client, ceiling) and applies
  // the same sliding session as every other token.
  const saved = await model.saveToken(
    {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(now.getTime() + MCP_DEVICE_ACCESS_TOKEN_SECONDS * 1000),
      refreshTokenExpiresAt: new Date(now.getTime() + MCP_ABSOLUTE_SESSION_DAYS * 86_400_000),
      scope: row.approvedScopes,
      client: oauthClient,
      user,
    },
    oauthClient,
    user
  );
  if (!saved) return { ok: false, error: 'invalid_grant' };
  await logAudit(
    {
      source: 'AUTH',
      action: 'mcp.device.consumed',
      entityType: 'SYSTEM_CONFIG',
      entityId: row.grantId,
      actorId: row.userId,
      details: { clientId: client.id, deviceAuthorizationId: row.id },
    },
    tx
  );
  const scopes: string[] = Array.isArray(saved.scope) ? saved.scope : row.approvedScopes;
  return {
    ok: true,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: MCP_DEVICE_ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
  };
}

/**
 * The signed-in person's own pending device sign-in and its client, for the verification page:
 * only a request this person already claimed by entering its code, still pending and unexpired,
 * from a client that is still allowed the device grant. Anything else is null.
 */
export async function assertCanReviewMcpDevice(id: string, userId: string, policy: McpPolicy) {
  const pending = await prisma.mcpDeviceAuthorization.findFirst({
    where: { id, userId, status: 'PENDING', expiresAt: { gt: new Date() } },
  });
  if (!pending) return null;
  const client = await prisma.mcpClient.findUnique({ where: { id: pending.clientId } });
  if (!client || !mcpDeviceClientCeiling(client, policy)) return null;
  return { pending, client };
}
