import type { Prisma } from '@prisma/client';
import type { AuthorizationAction, AuthorizationActor } from '@/lib/authorization-policy';
import { enforceV2Authorization } from '@/lib/api-v2/rbac';
import { resolveMcpGrant } from '../auth/principal';
import { requireMcp } from './errors';

/** Shared transaction fence for reviewed commands and canonical REST mutations. */
export async function lockMcpMutationAuthority(
  tx: Prisma.TransactionClient,
  context: { grantId: string; credentialId?: string; tokenScopes: readonly string[] },
  requiredScopes: readonly string[],
  actions: readonly AuthorizationAction[],
  expected?: AuthorizationActor
) {
  // Client before grant matches client revocation's update order.
  await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id =
    (SELECT "clientId" FROM "McpGrant" WHERE id = ${context.grantId}) FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "McpGrant" WHERE id = ${context.grantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id =
    (SELECT "userId" FROM "McpGrant" WHERE id = ${context.grantId}) FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TeamMember" WHERE "userId" =
    (SELECT "userId" FROM "McpGrant" WHERE id = ${context.grantId}) ORDER BY id FOR SHARE`;
  if (context.credentialId)
    await tx.$queryRaw`
    SELECT id FROM "McpToken" WHERE id = ${context.credentialId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR SHARE`;
  const auth = await resolveMcpGrant(context.grantId, context.credentialId, tx);
  if (expected)
    requireMcp(
      auth.actor.id === expected.id &&
        auth.actor.role === expected.role &&
        JSON.stringify([...auth.actor.teamIds].sort()) ===
          JSON.stringify([...expected.teamIds].sort()),
      'MCP_AUTHORITY_CHANGED',
      403
    );
  const credential = context.credentialId
    ? await tx.mcpToken.findUnique({
        where: { id: context.credentialId },
        select: { scopes: true },
      })
    : undefined;
  auth.apiKey.scopes = auth.apiKey.scopes.filter(
    scope =>
      context.tokenScopes.includes(scope) &&
      (!context.credentialId || credential?.scopes.includes(scope))
  );
  auth.actor.apiKey = { id: auth.apiKey.id, scopes: auth.apiKey.scopes };
  requireMcp(
    requiredScopes.every(scope => auth.apiKey.scopes.includes(scope)),
    'MCP_OPERATION_FORBIDDEN',
    403
  );
  for (const action of actions) enforceV2Authorization(auth.actor, action);
  const policy = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
  requireMcp(policy?.enabled && policy.writesEnabled, 'MCP_OPERATION_DISABLED', 403);
  return auth;
}
