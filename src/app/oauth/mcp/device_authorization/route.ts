import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { withMcpDatabase } from '@/lib/database-workload';
import { digestMcpSecret, mcpOrigin, mcpResource, withMcpRuntime } from '@/lib/mcp/auth/config';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { isCimdClientId } from '@/lib/mcp/auth/cimd';
import { urlForLog } from '@/lib/mcp/auth/redirect-uri';
import {
  MCP_DEVICE_CODE_TTL_SECONDS,
  MCP_DEVICE_POLL_INTERVAL_SECONDS,
  mcpDeviceClientCeiling,
  mcpDeviceCodeDigest,
  mcpUserCodeDigest,
  newMcpDeviceCode,
  newMcpUserCode,
  normalizeMcpUserCode,
} from '@/lib/mcp/auth/device-flow';
import { observeMcpOAuth } from '@/lib/mcp/auth/oauth-observability';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';

export const runtime = 'nodejs';

/** Device sign-ins one client may start per minute; each is a row waiting up to ten minutes. */
const PER_CLIENT_PER_MINUTE = 30;

const OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_scope',
  'invalid_target',
]);

const schema = z
  .object({
    client_id: z.string().min(1).max(256),
    scope: z.string().max(2048).optional(),
    // RFC 8707: optional; the audience is always this server's MCP URL.
    resource: z.string().url().optional(),
  })
  // RFC 8628 §3.1 / RFC 6749 §3.2: unrecognized parameters are ignored, never refused.
  .strip();

/** RFC 8628 §3.1-3.2: start a device sign-in and hand the device its codes. */
export function POST(request: Request) {
  return observeMcpOAuth('device_authorization', request, () =>
    withMcpDatabase(() => withMcpRuntime(() => handlePost(request)))
  );
}

async function handlePost(request: Request) {
  try {
    assertMcpHost(request);
    const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
    // Off means absent: the endpoint is not advertised and answers as if it did not exist.
    requireMcp(
      mcpPolicyInForce(policy) && policy?.deviceFlowEnabled,
      'MCP_DEVICE_FLOW_DISABLED',
      404
    );
    await admitMcpOAuthRequest(request, 'device_authorization');
    requireMcp(
      request.headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded',
      'invalid_request',
      415
    );
    const form = await readBoundedMcpText(request, 8192);
    const body = schema.parse(uniqueQuery(new URLSearchParams(form)));
    requireMcp(!body.resource || body.resource === mcpResource(), 'invalid_target');
    requireMcp(
      (
        await checkRateLimit(
          `mcp:oauth:device_authorization:client:${digestMcpSecret(`device-client:${body.client_id}`)}`,
          PER_CLIENT_PER_MINUTE,
          60000
        )
      ).allowed,
      'MCP_RATE_LIMITED',
      429
    );
    const deny: (reason: string) => never = reason => {
      logger.warn('mcp.device.client_denied', { clientId: urlForLog(body.client_id), reason });
      // RFC 6749 §5.2: an unidentifiable client is invalid_client with 401.
      throw new McpBoundaryError('invalid_client', 401);
    };
    // A metadata document is fetched for a browser sign-in with a redirect URI to check; an
    // anonymous device request must never make this server fetch an arbitrary URL.
    if (isCimdClientId(body.client_id)) deny('metadata_document_clients_unsupported');
    const client = await prisma.mcpClient.findUnique({ where: { id: body.client_id } });
    if (!client) deny('unknown_client_id');
    if (client.revokedAt) deny('client_revoked');
    if (!client.deviceCodeGrant) deny('device_grant_not_registered');
    const ceiling = mcpDeviceClientCeiling(client, policy);
    if (!ceiling) deny('no_scopes_allowed_for_this_client');
    // The same narrowing as the browser flow: what the client named and the policy permits,
    // or everything the policy permits when it named nothing usable.
    const asked = body.scope ? [...new Set(body.scope.split(' ').filter(Boolean))] : [];
    const allowed = ceiling.filter(scope => scope !== 'admin:manage');
    const narrowed = asked.filter(scope => allowed.includes(scope));
    const scopes = narrowed.length ? narrowed : allowed;
    requireMcp(scopes.length > 0, 'invalid_scope');
    const deviceCode = newMcpDeviceCode();
    let userCode = '';
    let created: { id: string } | undefined;
    // A user code collides with a live one about once in billions; draw again if it does.
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      userCode = newMcpUserCode();
      try {
        created = await prisma.$transaction(async tx => {
          // Coordinate with unused-registration cleanup, as the browser flow does.
          await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id = ${client.id} FOR SHARE`;
          const current = await tx.mcpClient.findUnique({ where: { id: client.id } });
          requireMcp(mcpDeviceClientCeiling(current, policy), 'invalid_client', 401);
          const row = await tx.mcpDeviceAuthorization.create({
            data: {
              clientId: client.id,
              deviceCodeHash: mcpDeviceCodeDigest(deviceCode),
              userCodeHash: mcpUserCodeDigest(normalizeMcpUserCode(userCode)!),
              scopes,
              requestedScopes: narrowed,
              resource: mcpResource(),
              interval: MCP_DEVICE_POLL_INTERVAL_SECONDS,
              expiresAt: new Date(Date.now() + MCP_DEVICE_CODE_TTL_SECONDS * 1000),
            },
            select: { id: true },
          });
          await logAudit(
            {
              source: 'AUTH',
              action: 'mcp.device.requested',
              entityType: 'SYSTEM_CONFIG',
              entityId: row.id,
              details: { clientId: client.id, clientName: client.name, scopes },
            },
            tx
          );
          return row;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
          throw error;
      }
    }
    requireMcp(created, 'temporarily_unavailable', 503);
    const verificationUri = `${mcpOrigin()}/oauth/mcp/device`;
    return Response.json(
      {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?user_code=${userCode}`,
        expires_in: MCP_DEVICE_CODE_TTL_SECONDS,
        interval: MCP_DEVICE_POLL_INTERVAL_SECONDS,
      },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: 'invalid_request' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    // OAuth codes are answered as RFC 6749 §5.2 errors, without a bearer challenge.
    if (error instanceof McpBoundaryError && OAUTH_ERRORS.has(error.code))
      return Response.json(
        { error: error.code },
        {
          status: error.code === 'invalid_client' ? 401 : error.status,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    if (!(error instanceof McpBoundaryError))
      logger.warn('mcp.device.unexpected_error', {
        name: error instanceof Error ? error.name : typeof error,
      });
    return mcpHttpError(error);
  }
}
