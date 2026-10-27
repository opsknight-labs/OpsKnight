import { mcpIssuer, mcpResource } from '@/lib/mcp/auth/config';
export function GET() {
  return Response.json(
    {
      resource: mcpResource(),
      authorization_servers: [mcpIssuer()],
      bearer_methods_supported: ['header'],
      resource_name: 'OpsKnight MCP',
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
}
