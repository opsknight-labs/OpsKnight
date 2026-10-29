import { getMcpConfigurationStatus } from './config';
import prisma from '@/lib/prisma';

export type McpSetupCheck = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};
export type McpSetupReport = { endpoint: string | null; ready: boolean; checks: McpSetupCheck[] };

const MAX_BYTES = 16384;
const TIMEOUT_MS = 8000;

async function readJson(response: Response) {
  if (!response.ok) throw new Error('status');
  if (!/^application\/json\s*(;|$)/i.test(response.headers.get('content-type') ?? ''))
    throw new Error('content-type');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('size');
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Administrator-facing readiness check. It only contacts this installation's own configured
 * public address (never an address supplied by a request), follows no redirects and creates no
 * credentials. A fetch failure from the server itself is a warning: some networks cannot loop
 * back to their own public name even though assistants outside can reach it.
 */
export async function runMcpSetupCheck(fetcher: typeof fetch = fetch): Promise<McpSetupReport> {
  const checks: McpSetupCheck[] = [];
  const add = (id: string, status: McpSetupCheck['status'], message: string) =>
    checks.push({ id, status, message });
  const configuration = await getMcpConfigurationStatus({ force: true });
  if (configuration.issues.length)
    for (const issue of configuration.issues) add('configuration', 'fail', issue);
  else add('configuration', 'pass', 'App URL and encryption key are configured.');
  const endpoint = configuration.origin ? `${configuration.origin}/mcp` : null;

  try {
    await prisma.mcpPolicy.findFirst({ select: { sessionIdleDays: true } });
    add('database', 'pass', 'Database migrations for MCP are applied.');
  } catch {
    add(
      'database',
      'fail',
      'MCP database tables are out of date. Run database migrations on every replica and restart.'
    );
  }
  if (!endpoint || configuration.issues.length) {
    return { endpoint, ready: false, checks };
  }
  const origin = configuration.origin!;
  const issuer = `${origin}/oauth/mcp`;
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const get = (url: string, init: RequestInit = {}) =>
    fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
  const unreachable =
    'This server could not reach its own public address. If assistants can connect, this is only a network loopback limit; otherwise check DNS, TLS and your reverse proxy.';

  try {
    const resource = await readJson(
      await get(resourceMetadata, { headers: { accept: 'application/json' } })
    );
    const servers = resource.authorization_servers;
    if (resource.resource === endpoint && Array.isArray(servers) && servers.includes(issuer))
      add('resource', 'pass', 'Discovery matches your public URL.');
    else
      add(
        'resource',
        'fail',
        'Discovery does not match the App URL. Check Settings → System and that your proxy preserves the Host header.'
      );
  } catch {
    add('resource', 'warn', unreachable);
  }
  try {
    const auth = await readJson(
      await get(`${origin}/.well-known/oauth-authorization-server/oauth/mcp`, {
        headers: { accept: 'application/json' },
      })
    );
    const methods = auth.token_endpoint_auth_methods_supported;
    const challenge = auth.code_challenge_methods_supported;
    const valid =
      auth.issuer === issuer &&
      auth.authorization_endpoint === `${issuer}/authorize` &&
      auth.token_endpoint === `${issuer}/token` &&
      Array.isArray(methods) &&
      methods.includes('none') &&
      Array.isArray(challenge) &&
      challenge.includes('S256');
    add(
      'oauth',
      valid ? 'pass' : 'fail',
      valid
        ? 'Sign-in endpoints are reachable and use PKCE.'
        : 'Sign-in metadata is incomplete or belongs to another address. Check the App URL and proxy routing.'
    );
    if (auth.registration_endpoint === `${issuer}/register`)
      add('automatic', 'pass', 'Assistants can connect automatically with just the URL.');
    else if (auth.client_id_metadata_document_supported === true)
      add(
        'automatic',
        'warn',
        'Only assistants that identify with a metadata document can connect.'
      );
    else
      add(
        'automatic',
        'fail',
        'Automatic connections are off. Turn on "Automatic connections" below and save.'
      );
  } catch {
    add('oauth', 'warn', unreachable);
  }
  try {
    const response = await get(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    void response.body?.cancel().catch(() => undefined);
    const challenge = response.headers.get('www-authenticate') ?? '';
    if (response.status === 401 && challenge.includes(`resource_metadata="${resourceMetadata}"`))
      add(
        'authentication',
        'pass',
        'Anonymous access is refused and assistants are sent to sign in.'
      );
    else if (response.status === 503)
      add('authentication', 'fail', 'MCP is turned off or unavailable. Enable it and save.');
    else
      add(
        'authentication',
        'fail',
        'Expected a sign-in challenge from the MCP endpoint. Check that your proxy forwards /mcp and /oauth/mcp unchanged.'
      );
  } catch {
    add('authentication', 'warn', unreachable);
  }
  return { endpoint, ready: checks.every(check => check.status !== 'fail'), checks };
}
