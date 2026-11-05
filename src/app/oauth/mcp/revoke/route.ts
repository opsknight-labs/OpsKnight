import { logAudit } from '@/lib/audit';
import { withMcpDatabase } from '@/lib/database-workload';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { acquireMcpOAuthSlot, admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { digestMcpSecret, withMcpRuntime } from '@/lib/mcp/auth/config';
import { browserPreflight, withBrowserCors } from '@/lib/mcp/auth/cors';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { requireMcp } from '@/lib/mcp/core/errors';

const schema = z
  .object({
    client_id: z.string().min(1).max(256),
    token: z.string().min(1).max(256),
    // Ignored: both access and refresh tokens are looked up (RFC 7009 section 2.1).
    token_type_hint: z.string().max(64).optional(),
  })
  // RFC 7009 extensions and unknown parameters are ignored; duplicates are still refused.
  .strip();
export function POST(request: Request) {
  return withMcpDatabase(() =>
    withMcpRuntime(() => withBrowserCors(request, origin => handlePost(request, origin)))
  );
}
export const OPTIONS = browserPreflight;

async function handlePost(request: Request, browserOrigin: string | null) {
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request, false, browserOrigin);
    release = await acquireMcpOAuthSlot('revoke');
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
