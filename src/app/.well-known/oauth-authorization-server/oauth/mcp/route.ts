import prisma from '@/lib/prisma';
import { mcpIssuer } from '@/lib/mcp/auth/config';
import { withMcpDatabase } from '@/lib/database-workload';

export function GET() {
  return withMcpDatabase(async () => {
    const issuer = mcpIssuer();
    const policy = await prisma.mcpPolicy.findUnique({
      where: { id: 'default' },
      select: { cimdEnabled: true, cimdAllowedHosts: true, cimdScopes: true },
    });
    // Advertise only what is enabled and usable in this deployment.
    const cimd = Boolean(
      policy?.cimdEnabled && policy.cimdAllowedHosts.length && policy.cimdScopes.length
    );
    return Response.json(
      {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: cimd,
      },
      { headers: { 'Cache-Control': cimd ? 'public, max-age=60' : 'public, max-age=300' } }
    );
  });
}
