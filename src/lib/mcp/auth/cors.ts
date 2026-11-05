import { withMcpDatabase } from '@/lib/database-workload';
import { withMcpRuntime } from './config';
import { loadDiscoveryPolicy } from './discovery-policy';
import { assertMcpHost } from './http';

/**
 * Browser access for MCP clients that run in a web page (MCP Inspector, hosted inspectors,
 * client-side agent apps). Every foreign Origin is still refused with 403 unless an administrator
 * listed it exactly under Allowed browser origins. Only bearer-authenticated or public-client
 * endpoints are covered (/mcp, token, register, revoke), and credentials are never allowed, so a
 * page cannot ride a person's cookies. Consent and review pages keep the strict same-origin check.
 */

const ALLOW_HEADERS =
  'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID';
const EXPOSE_HEADERS = 'WWW-Authenticate, Mcp-Session-Id, X-Request-Id, Retry-After';

/** Discovery documents are public and uncredentialed, so any page may read them. */
export const PUBLIC_METADATA_CORS = { 'Access-Control-Allow-Origin': '*' } as const;

export function publicMetadataPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...PUBLIC_METADATA_CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Mcp-Protocol-Version',
      'Access-Control-Max-Age': '600',
    },
  });
}

/** The request's Origin when an administrator allowed it exactly; otherwise null. */
export async function allowedBrowserOrigin(request: Request): Promise<string | null> {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    const policy = await loadDiscoveryPolicy();
    return policy?.allowedBrowserOrigins.includes(origin) ? origin : null;
  } catch {
    // A policy that cannot be read allows no foreign origin; the request then gets its 403.
    return null;
  }
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': EXPOSE_HEADERS,
    Vary: 'Origin',
  };
}

/** Adds CORS headers for an allowed origin; never Access-Control-Allow-Credentials. */
export function applyBrowserCors(response: Response, origin: string | null) {
  if (!origin) return response;
  try {
    for (const [name, value] of Object.entries(corsHeaders(origin)))
      response.headers.set(name, value);
    return response;
  } catch {
    // Immutable headers (a fetched or redirected response): copy them onto a new response.
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/** Runs a handler with the request's allowed browser origin and adds CORS to whatever it returns. */
export async function withBrowserCors(
  request: Request,
  handler: (browserOrigin: string | null) => Promise<Response>
) {
  const origin = await allowedBrowserOrigin(request);
  return applyBrowserCors(await handler(origin), origin);
}

/** OPTIONS for a POST endpoint: 204 only for an allowed origin on the configured host. */
export function browserPreflight(request: Request) {
  return withMcpDatabase(() =>
    withMcpRuntime(async () => {
      const origin = await allowedBrowserOrigin(request);
      try {
        if (!origin) throw new Error('origin not allowed');
        assertMcpHost(request, false, origin);
      } catch {
        return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': ALLOW_HEADERS,
          'Access-Control-Max-Age': '600',
        },
      });
    })
  );
}
