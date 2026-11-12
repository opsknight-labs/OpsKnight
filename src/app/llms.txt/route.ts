import { withMcpDatabase } from '@/lib/database-workload';
import { loadMcpRuntime, mcpOrigin } from '@/lib/mcp/auth/config';
import { loadDiscoveryPolicy } from '@/lib/mcp/auth/discovery-policy';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';
import { MCP_DOCS_LINKS, mcpDocsHref } from '@/lib/mcp/docs-links';

export const dynamic = 'force-dynamic';

/**
 * /llms.txt (https://llmstxt.org) for this installation. Public, so it carries only what the
 * public discovery documents already reveal: no secrets, no user or tenant data. MCP facts appear
 * only while MCP is on and the public origin is configured.
 */
export function GET() {
  return withMcpDatabase(async () => {
    let origin: string | undefined;
    try {
      await loadMcpRuntime();
      if (mcpPolicyInForce(await loadDiscoveryPolicy())) origin = mcpOrigin();
    } catch {
      origin = undefined;
    }
    const lines = [
      '# OpsKnight',
      '',
      '> A self-hosted incident management installation: incidents, on-call schedules, escalation, services, runbooks and status pages.',
      '',
    ];
    if (origin) {
      lines.push(
        '## MCP server',
        '',
        `- Endpoint: ${origin}/mcp (Streamable HTTP; sign in with OAuth, or send a personal access token as a Bearer header where the administrator allows them)`,
        `- Protected resource metadata: ${origin}/.well-known/oauth-protected-resource/mcp`,
        `- Authorization server metadata: ${origin}/.well-known/oauth-authorization-server/oauth/mcp`,
        ''
      );
    } else {
      lines.push('AI assistant access (MCP) is not enabled on this installation.', '');
    }
    lines.push(
      '## Docs',
      '',
      `- [Connect an assistant](${MCP_DOCS_LINKS.guide})`,
      `- [Client setup guides](${mcpDocsHref('docs/v2.2.0/guides/mcp/clients/README.md')})`,
      `- [Troubleshooting](${MCP_DOCS_LINKS.troubleshooting})`,
      `- [Permissions](${MCP_DOCS_LINKS.permissions})`,
      ''
    );
    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  });
}
