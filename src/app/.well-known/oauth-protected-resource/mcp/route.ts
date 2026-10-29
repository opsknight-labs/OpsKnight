import { loadMcpRuntime, mcpIssuer, mcpResource } from '@/lib/mcp/auth/config';
import { withMcpDatabase } from '@/lib/database-workload';

export const dynamic = 'force-dynamic';

export function GET() {
  return withMcpDatabase(async () => {
    await loadMcpRuntime();
    return Response.json(
      {
        resource: mcpResource(),
        authorization_servers: [mcpIssuer()],
        bearer_methods_supported: ['header'],
        resource_name: 'OpsKnight MCP',
      },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    );
  });
}
