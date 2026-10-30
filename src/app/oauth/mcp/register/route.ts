import prisma from '@/lib/prisma';
import { withMcpDatabase } from '@/lib/database-workload';
import { withMcpRuntime } from '@/lib/mcp/auth/config';
import { assertMcpHost, mcpHttpError } from '@/lib/mcp/auth/http';
import { admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import {
  acquireRegistrationSlot,
  MAX_DYNAMIC_CLIENTS,
  registrationSchema,
} from '@/lib/mcp/auth/registration';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { rejectDuplicateJsonKeys } from '@/lib/mcp/protocol/input';
import { requireMcp } from '@/lib/mcp/core/errors';
import { z } from 'zod/v3';

export const runtime = 'nodejs';
export function POST(request: Request) {
  return withMcpDatabase(() => withMcpRuntime(() => handlePost(request)));
}
async function handlePost(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request);
    release = acquireRegistrationSlot();
    const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
    requireMcp(policy?.enabled && policy.dcrEnabled, 'MCP_REGISTRATION_DISABLED', 403);
    await admitMcpOAuthRequest(request, 'register');
    requireMcp(
      request.headers.get('content-type')?.split(';')[0] === 'application/json',
      'invalid_request',
      415
    );
    const raw = await readBoundedMcpText(request, 8192);
    rejectDuplicateJsonKeys(raw);
    const input = registrationSchema.parse(JSON.parse(raw));
    const client = await prisma.$transaction(
      async tx => {
        // Serialize the capacity check with creation, and pin current enablement/scope policy.
        await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR UPDATE`;
        const current = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
        requireMcp(
          current?.enabled && current.dcrEnabled && current.dcrScopes.length,
          'MCP_REGISTRATION_DISABLED',
          403
        );
        const asked = input.scope ? [...new Set(input.scope.split(/\s+/))] : [];
        const allowed = current.dcrScopes.filter(scope => scope !== 'admin:manage');
        const narrowed = asked.filter(scope => allowed.includes(scope));
        const scopes = narrowed.length ? narrowed : allowed;
        requireMcp(scopes.length, 'invalid_client_metadata');
        if (
          (await tx.mcpClient.count({ where: { dynamicRegistration: true, revokedAt: null } })) >=
          MAX_DYNAMIC_CLIENTS
        ) {
          // Full: make room by evicting the oldest registration that was never used to sign in
          // and has no sign-in in progress, so filling the table cannot block real assistants.
          const [stale] = await tx.$queryRaw<{ id: string }[]>`SELECT c.id FROM "McpClient" c
            WHERE c."dynamicRegistration" AND c."firstAuthorizedAt" IS NULL
              AND c."createdAt" < now() - interval '1 hour'
              AND NOT EXISTS (SELECT 1 FROM "McpGrant" g WHERE g."clientId" = c.id)
              AND NOT EXISTS (SELECT 1 FROM "McpConsentRequest" r
                WHERE r."clientId" = c.id AND r."consumedAt" IS NULL AND r."expiresAt" > now())
            ORDER BY c."createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
          requireMcp(stale, 'MCP_REGISTRATION_CAPACITY', 503);
          await tx.mcpClient.delete({ where: { id: stale.id } });
        }
        return tx.mcpClient.create({
          data: {
            name: input.client_name,
            redirectUris: input.redirect_uris,
            scopes,
            dynamicRegistration: true,
          },
        });
      },
      { timeout: 5000 }
    );
    return Response.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: client.scopes.join(' '),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: 'invalid_client_metadata' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    return mcpHttpError(error);
  } finally {
    release?.();
  }
}
