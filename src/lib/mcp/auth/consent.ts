import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { requireMcp } from '../core/errors';

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
