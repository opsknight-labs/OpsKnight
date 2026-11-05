import { loadMcpRuntime, mcpIssuer, mcpResource } from '@/lib/mcp/auth/config';
import { withMcpDatabase } from '@/lib/database-workload';
import { loadDiscoveryPolicy } from '@/lib/mcp/auth/discovery-policy';
import { PUBLIC_METADATA_CORS, publicMetadataPreflight } from '@/lib/mcp/auth/cors';

export const dynamic = 'force-dynamic';

export function GET() {
  return withMcpDatabase(async () => {
    await loadMcpRuntime();
    const policy = await loadDiscoveryPolicy();
    // Tell clients which scopes to ask for so they request something the policy will grant.
    const scopes = policy?.enabled
      ? [
          ...new Set([
            ...(policy.dcrEnabled ? policy.dcrScopes : []),
            ...(policy.cimdEnabled ? policy.cimdScopes : []),
          ]),
        ]
      : [];
    return Response.json(
      {
        resource: mcpResource(),
        authorization_servers: [mcpIssuer()],
        bearer_methods_supported: ['header'],
        resource_name: 'OpsKnight MCP',
        ...(scopes.length ? { scopes_supported: scopes } : {}),
      },
      { headers: { 'Cache-Control': 'public, max-age=60', ...PUBLIC_METADATA_CORS } }
    );
  });
}

export const OPTIONS = publicMetadataPreflight;
