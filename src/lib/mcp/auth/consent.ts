import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { requireMcp } from '../core/errors';
import { mcpIssuer } from './config';
import { friendlyMcpError } from './friendly-error';
import { redirectUriAllowed } from './redirect-uri';

/** Consent is a personal resource. An administrator cannot accept for another user. */
export async function assertCanReviewMcpConsent(id: string) {
  const user = await getCurrentUser();
  requireMcp(user.status === 'ACTIVE', 'MCP_INACTIVE_PRINCIPAL', 403);
  const request = await prisma.mcpConsentRequest.findFirst({
    where: { id, userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
  });
  requireMcp(request, 'MCP_CONSENT_EXPIRED');
  const client = await prisma.mcpClient.findUnique({ where: { id: request.clientId } });
  requireMcp(client && !client.revokedAt, 'MCP_CLIENT_REVOKED');
  return { request, client };
}

/**
 * Where to send the signed-in user when their own consent request timed out unused: back to the
 * assistant's pre-registered redirect URI with a retryable OAuth error. Never for a request that
 * belongs to someone else, was already used, or whose client no longer owns that address.
 */
export async function expiredConsentReturn(id: string) {
  const user = await getCurrentUser();
  const request = await prisma.mcpConsentRequest.findFirst({
    where: { id, userId: user.id, consumedAt: null, expiresAt: { lte: new Date() } },
  });
  if (!request) return null;
  const client = await prisma.mcpClient.findUnique({ where: { id: request.clientId } });
  if (!client || client.revokedAt || !redirectUriAllowed(client.redirectUris, request.redirectUri))
    return null;
  const target = new URL(request.redirectUri);
  target.searchParams.set('error', 'temporarily_unavailable');
  target.searchParams.set('error_description', friendlyMcpError('MCP_CONSENT_EXPIRED').body);
  if (request.state) target.searchParams.set('state', request.state);
  target.searchParams.set('iss', mcpIssuer());
  return target.href;
}

/**
 * The person's earlier live connections that a new consent for this assistant replaces: the same
 * client, or another registration of the same metadata document (assistants re-register).
 */
export function supersededMcpGrantsWhere(
  userId: string,
  client: { id: string; metadataUrl: string | null },
  now = new Date()
): Prisma.McpGrantWhereInput {
  return {
    userId,
    revokedAt: null,
    expiresAt: { gt: now },
    OR: [
      { clientId: client.id },
      ...(client.metadataUrl ? [{ client: { metadataUrl: client.metadataUrl } }] : []),
    ],
  };
}
