import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { runWithContext } from '@/lib/logger';
import { trustedMcpRequestId } from '../request-id';

export const MCP_OAUTH_ENDPOINTS = [
  'authorize',
  'token',
  'register',
  'revoke',
  'device_authorization',
] as const;
export type McpOAuthEndpoint = (typeof MCP_OAUTH_ENDPOINTS)[number];

/** Every value the `outcome` label of opsknight_mcp_oauth_requests_total can take. */
export const MCP_OAUTH_OUTCOMES = [
  'issued',
  'invalid_request',
  'invalid_grant',
  'invalid_client',
  'invalid_scope',
  'rate_limited',
  // Device flow polls (RFC 8628 §3.5): still waiting (authorization_pending or slow_down), the
  // person said no, or the code ran out before anyone approved it.
  'pending',
  'denied',
  'expired',
  'unavailable',
  'server_error',
] as const;
export type McpOAuthOutcome = (typeof MCP_OAUTH_OUTCOMES)[number];

const CODE_OUTCOMES = new Map<string, McpOAuthOutcome>([
  ['invalid_request', 'invalid_request'],
  ['invalid_target', 'invalid_request'],
  ['unsupported_grant_type', 'invalid_request'],
  ['invalid_grant', 'invalid_grant'],
  ['invalid_client', 'invalid_client'],
  ['invalid_client_metadata', 'invalid_client'],
  ['invalid_redirect_uri', 'invalid_client'],
  ['unauthorized_client', 'invalid_client'],
  ['invalid_scope', 'invalid_scope'],
  ['access_denied', 'denied'],
  ['authorization_pending', 'pending'],
  ['slow_down', 'pending'],
  ['expired_token', 'expired'],
  ['temporarily_unavailable', 'unavailable'],
  ['server_error', 'server_error'],
]);

/**
 * The outcome of one OAuth response, read from the status and error code that were actually sent:
 * a JSON `error`, or the `error` parameter of a redirect back to the assistant.
 */
export async function mcpOAuthOutcome(response: Response): Promise<McpOAuthOutcome> {
  const status = response.status;
  let code: string | undefined;
  if (status >= 300 && status < 400) {
    const location = response.headers.get('location');
    try {
      code = location ? (new URL(location).searchParams.get('error') ?? undefined) : undefined;
    } catch {
      code = undefined;
    }
    if (!code) return 'issued';
  } else if (status < 300) return 'issued';
  if (status === 429) return 'rate_limited';
  if (!code && response.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      code = typeof body?.error === 'string' ? body.error : undefined;
    } catch {
      code = undefined;
    }
  }
  const known = code ? CODE_OUTCOMES.get(code) : undefined;
  if (known) return known;
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server_error';
  if (status === 401) return 'invalid_client';
  return 'invalid_request';
}

/**
 * Runs one OAuth endpoint with a correlation id on every log line and on the response, and
 * counts the response once by endpoint and outcome. Form values, codes and tokens never reach it.
 */
export async function observeMcpOAuth(
  endpoint: McpOAuthEndpoint,
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const requestId = trustedMcpRequestId(request);
  let response = await runWithContext({ requestId, component: 'mcp-oauth' }, handler);
  try {
    response.headers.set('X-Request-Id', requestId);
  } catch {
    // A redirect from the framework can carry immutable headers; rebuild it with the id.
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    response = new Response(response.body, { status: response.status, headers });
  }
  addOperationalMetric('opsknight_mcp_oauth_requests_total', 1, {
    endpoint,
    outcome: await mcpOAuthOutcome(response),
  });
  return response;
}
