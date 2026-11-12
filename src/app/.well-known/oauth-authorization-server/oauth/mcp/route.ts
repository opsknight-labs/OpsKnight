import { loadMcpRuntime, mcpIssuer } from '@/lib/mcp/auth/config';
import { withMcpDatabase } from '@/lib/database-workload';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';
import { loadDiscoveryPolicy } from '@/lib/mcp/auth/discovery-policy';
import { PUBLIC_METADATA_CORS, publicMetadataPreflight } from '@/lib/mcp/auth/cors';
import { MCP_DEVICE_CODE_GRANT } from '@/lib/mcp/auth/device-flow';
import {
  MCP_ID_JAG_PROFILE,
  MCP_JWT_BEARER_GRANT,
  mcpEnterpriseGrantIssuer,
} from '@/lib/mcp/auth/enterprise-grant';

export function GET() {
  return withMcpDatabase(async () => {
    await loadMcpRuntime();
    const issuer = mcpIssuer();
    const policy = await loadDiscoveryPolicy();
    // Advertise only what is enabled and usable in this deployment.
    const enabled = mcpPolicyInForce(policy);
    const cimd = Boolean(enabled && policy?.cimdEnabled && policy.cimdScopes.length);
    // The device flow (RFC 8628) is advertised only while an administrator has it turned on.
    const device = Boolean(enabled && policy?.deviceFlowEnabled);
    // Enterprise-managed authorization: only while switched on and single sign-on is configured.
    const idJag = Boolean(enabled && (await mcpEnterpriseGrantIssuer(policy)));
    const scopes =
      enabled && policy
        ? [
            ...new Set([
              ...(policy.dcrEnabled ? policy.dcrScopes : []),
              ...(cimd ? policy.cimdScopes : []),
            ]),
          ]
        : [];
    return Response.json(
      {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/revoke`,
        // Public clients revoke with client_id in the body (RFC 8414 defaults to client_secret_basic).
        revocation_endpoint_auth_methods_supported: ['none'],
        response_types_supported: ['code'],
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          ...(device ? [MCP_DEVICE_CODE_GRANT] : []),
          ...(idJag ? [MCP_JWT_BEARER_GRANT] : []),
        ],
        ...(idJag ? { authorization_grant_profiles_supported: [MCP_ID_JAG_PROFILE] } : {}),
        ...(device ? { device_authorization_endpoint: `${issuer}/device_authorization` } : {}),
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: cimd,
        ...(enabled && policy?.dcrEnabled && policy.dcrScopes.length
          ? { registration_endpoint: `${issuer}/register` }
          : {}),
        ...(scopes.length ? { scopes_supported: scopes } : {}),
      },
      { headers: { 'Cache-Control': 'no-store', ...PUBLIC_METADATA_CORS } }
    );
  });
}

export const OPTIONS = publicMetadataPreflight;
