import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { digestMcpSecret } from '@/lib/mcp/auth/config';

/** Read scopes only: the load scenario never changes anything. */
export const MCP_LOAD_SCOPES = ['incidents:read', 'services:read', 'teams:read'];

/**
 * OBS-10: one MCP grant and access token per load principal, minted with the same digest the
 * token endpoint stores, so k6 drives `/mcp` exactly as assistants do. One grant per virtual user,
 * so per-grant limits do not hide the load. The tokens go into the seed manifest (already a
 * credential file, like its API keys and session cookies) and expire with the run.
 */
export async function seedMcpLoadPrincipals(
  prisma: PrismaClient,
  userIds: readonly string[],
  options: { count: number; origin: string; ttlMs?: number }
) {
  // The grant's audience must be the server's own resource: its App URL plus /mcp.
  const resource = `${options.origin.replace(/\/$/, '')}/mcp`;
  const count = Math.min(options.count, userIds.length);
  if (count <= 0) return { resource, tokens: [] as string[] };
  const ttlMs = options.ttlMs ?? 6 * 3600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  // Realistic limits, so the run measures the real admission and quota paths.
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await prisma.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  const client = await prisma.mcpClient.upsert({
    where: { id: 'lt-mcp-client' },
    create: {
      id: 'lt-mcp-client',
      name: 'Load test assistant',
      scopes: MCP_LOAD_SCOPES,
      redirectUris: ['http://127.0.0.1/callback'],
    },
    update: {},
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds.slice(0, count)] } },
    select: { id: true, tokenVersion: true },
  });
  const tokens: string[] = [];
  for (const user of users) {
    const grant = await prisma.mcpGrant.create({
      data: {
        clientId: client.id,
        userId: user.id,
        userTokenVersion: user.tokenVersion,
        scopes: MCP_LOAD_SCOPES,
        resource,
        expiresAt,
      },
    });
    const bearer = randomBytes(32).toString('base64url');
    await prisma.mcpToken.create({
      data: {
        grantId: grant.id,
        scopes: MCP_LOAD_SCOPES,
        accessHash: digestMcpSecret(bearer),
        refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
        accessExpiresAt: expiresAt,
        refreshExpiresAt: expiresAt,
      },
    });
    tokens.push(bearer);
  }
  return { resource, tokens };
}
