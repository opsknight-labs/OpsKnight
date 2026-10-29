import { logAudit } from '@/lib/audit';
import { withMcpDatabase } from '@/lib/database-workload';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { acquireMcpOAuthSlot, admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { digestMcpSecret, withMcpRuntime } from '@/lib/mcp/auth/config';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { requireMcp } from '@/lib/mcp/core/errors';

const schema = z
  .object({
    client_id: z.string().min(1).max(256),
    token: z.string().min(1).max(256),
    token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  })
  .strict();
export function POST(request: Request) {
  return withMcpDatabase(() => withMcpRuntime(() => handlePost(request)));
}

async function handlePost(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request);
    release = acquireMcpOAuthSlot('revoke');
    await admitMcpOAuthRequest(request, 'revoke');
    requireMcp(
      request.headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded',
      'invalid_request',
      415
    );
    const input = schema.parse(
      uniqueQuery(new URLSearchParams(await readBoundedMcpText(request, 8192)))
    );
    const hash = digestMcpSecret(input.token);
    await prisma.$transaction(async tx => {
      const token = await tx.mcpToken.findFirst({
        where: {
          OR: [{ accessHash: hash }, { refreshHash: hash }],
          grant: { clientId: input.client_id },
        },
        select: { grantId: true },
      });
      if (!token) return;
      await tx.mcpGrant.update({ where: { id: token.grantId }, data: { revokedAt: new Date() } });
      await logAudit(
        {
          source: 'AUTH',
          action: 'mcp.grant.revoked',
          entityType: 'SYSTEM_CONFIG',
          entityId: token.grantId,
        },
        tx
      );
    });
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return mcpHttpError(error);
  } finally {
    release?.();
  }
}
