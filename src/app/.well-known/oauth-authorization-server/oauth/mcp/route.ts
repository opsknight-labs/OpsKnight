import { mcpIssuer } from '@/lib/mcp/auth/config';
export function GET() {
  const issuer = mcpIssuer();
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
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
}
