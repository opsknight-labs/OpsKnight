import type { Prisma } from '@prisma/client';
import type { AuthorizationAction, AuthorizationActor } from '@/lib/authorization-policy';
import { enforceV2Authorization } from '@/lib/api-v2/rbac';
import { resolveMcpGrant } from '../auth/principal';
import { requireMcp } from './errors';
import { mcpPolicyInForce } from './kill-switch';
import { isMcpCapabilityDisabled } from '../catalog/capabilities';

/** Shared transaction fence for reviewed commands and canonical REST mutations. */
export async function lockMcpMutationAuthority(
  tx: Prisma.TransactionClient,
  context: { grantId: string; credentialId?: string; tokenScopes: readonly string[] },
  requiredScopes: readonly string[],
  actions: readonly AuthorizationAction[],
  expected?: AuthorizationActor,
  /** Capability ids refused here, under the policy row lock, if an administrator disabled them. */
  capabilities: readonly string[] = []
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
  // Rows this transaction writes are marked as made through this assistant (the "channel"
  // column default reads the setting). Transaction-local, so a pooled connection never keeps it.
  await tx.$queryRaw`SELECT set_config('opsknight.channel', 'mcp:' || "clientId", true)
    FROM "McpGrant" WHERE id = ${context.grantId}`;
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
  requireMcp(
    policy && mcpPolicyInForce(policy) && policy.writesEnabled,
    'MCP_OPERATION_DISABLED',
    403
  );
  requireMcp(
    !isMcpCapabilityDisabled(policy.disabledCapabilities, ...capabilities),
    'MCP_CAPABILITY_DISABLED',
    403
  );
  return auth;
}
