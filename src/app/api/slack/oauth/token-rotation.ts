import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decrypt, encrypt } from '@/lib/encryption';

/**
 * Slack token rotation. An app with rotation on gets a 12-hour bot token plus a refresh token from
 * oauth.v2.access; both are stored encrypted on SlackIntegration (`refreshToken`, `tokenExpiresAt`).
 * Installs without rotation have neither and their long-lived token is returned exactly as before.
 */

/** Refresh this long before expiry, so a token read now is still valid for the call that uses it. */
export const SLACK_TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;

export type SlackStoredToken = {
  id: string;
  botToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
};

/** Token fields to store from an oauth.v2.access response; empty for a non-rotating token. */
export function slackRotationFields(
  tokenData: { refresh_token?: unknown; expires_in?: unknown },
  now = Date.now()
): { refreshToken: string; tokenExpiresAt: Date } | null {
  const refresh = typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : '';
  const expiresIn = Number(tokenData.expires_in);
  if (!refresh || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { refreshToken: refresh, tokenExpiresAt: new Date(now + expiresIn * 1000) };
}

export function slackTokenNeedsRefresh(
  integration: Pick<SlackStoredToken, 'refreshToken' | 'tokenExpiresAt'>,
  now = Date.now()
): boolean {
  return Boolean(
    integration.refreshToken &&
    integration.tokenExpiresAt &&
    integration.tokenExpiresAt.getTime() - now <= SLACK_TOKEN_REFRESH_MARGIN_MS
  );
}

const inFlight = new Map<string, Promise<string | null>>();

async function refreshSlackToken(integration: SlackStoredToken): Promise<string | null> {
  const config = await prisma.slackOAuthConfig.findFirst({
    where: { enabled: true },
    orderBy: { updatedAt: 'desc' },
  });
  const clientId = config?.clientId || process.env.SLACK_CLIENT_ID;
  const clientSecret = config
    ? await decrypt(config.clientSecret)
    : process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret || !integration.refreshToken) return null;
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: await decrypt(integration.refreshToken),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.ok || !data.access_token) {
    logger.warn('[Slack] Token refresh failed', {
      integrationId: integration.id,
      error: data.error ?? `HTTP ${response.status}`,
    });
    return null;
  }
  const rotation = slackRotationFields(data);
  // Compare-and-set on the old expiry: if another instance refreshed first, keep its tokens.
  await prisma.slackIntegration.updateMany({
    where: { id: integration.id, tokenExpiresAt: integration.tokenExpiresAt ?? null },
    data: {
      botToken: await encrypt(data.access_token),
      ...(rotation
        ? {
            refreshToken: await encrypt(rotation.refreshToken),
            tokenExpiresAt: rotation.tokenExpiresAt,
          }
        : {}),
    },
  });
  return data.access_token;
}

/**
 * The plaintext bot token of an installation, refreshed first when it rotates and is about to expire.
 * A failed refresh falls back to the stored token (still valid until it expires).
 */
export async function readSlackBotToken(integration: SlackStoredToken): Promise<string> {
  if (slackTokenNeedsRefresh(integration)) {
    let pending = inFlight.get(integration.id);
    if (!pending) {
      pending = refreshSlackToken(integration)
        .catch(error => {
          logger.warn('[Slack] Token refresh error', {
            integrationId: integration.id,
            error: error instanceof Error ? error.name : 'error',
          });
          return null;
        })
        .finally(() => inFlight.delete(integration.id));
      inFlight.set(integration.id, pending);
    }
    const fresh = await pending;
    if (fresh) return fresh;
  }
  return decrypt(integration.botToken);
}
