'use strict';

// Read-only setup checks: no credentials, registration, grants, or settings changes.
const MAX_METADATA_BYTES = 16384;
const REQUEST_TIMEOUT_MS = 8000;

function mcpEndpoint(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Use the MCP URL without credentials, query parameters or fragments.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('Use HTTPS; plain HTTP is allowed only on loopback for local testing.');
  if (url.pathname !== '/' && url.pathname !== '/mcp')
    throw new Error('Use your OpsKnight origin or the /mcp endpoint copied from MCP settings.');
  return `${url.origin}/mcp`;
}

async function metadata(response) {
  if (!response.ok) throw new Error('Metadata endpoint did not return HTTP 200.');
  if (!/^application\/json\s*(;|$)/i.test(response.headers.get('content-type') ?? ''))
    throw new Error('Metadata endpoint returned a non-JSON response.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Metadata response was empty.');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_METADATA_BYTES)
        throw new Error('Metadata exceeded the diagnostic size limit.');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

async function checkMcpSetup(value, fetcher = globalThis.fetch) {
  const endpoint = mcpEndpoint(value);
  const origin = new URL(endpoint).origin;
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const issuer = `${origin}/oauth/mcp`;
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const get = url =>
    fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  try {
    const resource = await metadata(await get(resourceMetadata));
    if (
      resource?.resource === endpoint &&
      Array.isArray(resource.authorization_servers) &&
      resource.authorization_servers.includes(issuer)
    )
      add('resource', 'pass', 'Protected-resource discovery matches this OpsKnight URL.');
    else
      add(
        'resource',
        'fail',
        'Discovery does not match the configured App URL. Check Settings → System and proxy Host preservation.'
      );
  } catch {
    add(
      'resource',
      'fail',
      'Cannot read protected-resource discovery. Check TLS, reachability, proxy routing and the deployed application.'
    );
  }
  try {
    // Only contact this installation; untrusted discovery cannot redirect the checker elsewhere.
    const auth = await metadata(
      await get(`${origin}/.well-known/oauth-authorization-server/oauth/mcp`)
    );
    const valid =
      auth?.issuer === issuer &&
      auth.authorization_endpoint === `${issuer}/authorize` &&
      auth.token_endpoint === `${issuer}/token` &&
      auth.revocation_endpoint === `${issuer}/revoke` &&
      Array.isArray(auth.code_challenge_methods_supported) &&
      auth.code_challenge_methods_supported.includes('S256') &&
      Array.isArray(auth.token_endpoint_auth_methods_supported) &&
      auth.token_endpoint_auth_methods_supported.includes('none') &&
      Array.isArray(auth.response_types_supported) &&
      auth.response_types_supported.includes('code') &&
      Array.isArray(auth.grant_types_supported) &&
      auth.grant_types_supported.includes('authorization_code') &&
      auth.authorization_response_iss_parameter_supported === true;
    add(
      'oauth',
      valid ? 'pass' : 'fail',
      valid
        ? 'OAuth endpoints, public-client PKCE and issuer identification are configured.'
        : 'OAuth metadata is incomplete or belongs to another origin. Check App URL, application version and proxy routing.'
    );
    if (auth?.registration_endpoint === `${issuer}/register`)
      add('automatic', 'pass', 'Automatic assistant registration is advertised.');
    else if (auth?.client_id_metadata_document_supported === true)
      add(
        'automatic',
        'warn',
        'Only trusted metadata-document clients can connect automatically. Enable automatic registration for the general URL-only setup.'
      );
    else
      add(
        'automatic',
        'fail',
        'Automatic connections are unavailable. Enable MCP and automatic assistant registration, save, and verify migrations and application rollout.'
      );
  } catch {
    add(
      'oauth',
      'fail',
      'Cannot read OAuth discovery. Check TLS, proxy routing, migrations and the deployed application.'
    );
  }
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const challenge = response.headers.get('www-authenticate') ?? '';
    const protectedEndpoint =
      response.status === 401 && challenge.includes(`resource_metadata="${resourceMetadata}"`);
    add(
      'authentication',
      protectedEndpoint ? 'pass' : 'fail',
      protectedEndpoint
        ? 'Anonymous access is denied with the expected OAuth discovery challenge.'
        : response.status === 503
          ? 'MCP is disabled or unavailable. Check MCP settings, App URL, the application encryption key and migrations.'
          : 'Expected an OAuth 401 challenge. Check authentication enforcement and proxy routing.'
    );
    void response.body?.cancel().catch(() => {});
  } catch {
    add(
      'authentication',
      'fail',
      'Cannot reach the protected MCP endpoint from this machine. Check TLS and network/proxy access.'
    );
  }
  return {
    endpoint,
    ready: checks.every(check => check.status !== 'fail'),
    checks,
    limitation:
      'Discovery checks only. Verify sign-in, scoped tools and revocation in each supported client; this does not certify production capacity or security.',
  };
}

module.exports = { checkMcpSetup, mcpEndpoint };
if (require.main === module) {
  const args = process.argv.slice(2);
  const url = args.find(arg => !arg.startsWith('--'));
  if (!url) {
    process.stderr.write('Usage: node scripts/mcp/doctor.cjs https://YOUR-HOST/mcp [--json]\n');
    process.exitCode = 1;
  } else
    checkMcpSetup(url)
      .then(report => {
        if (args.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        else {
          for (const check of report.checks)
            process.stdout.write(`${check.status.toUpperCase()} ${check.message}\n`);
          process.stdout.write(report.limitation + '\n');
        }
        process.exitCode = report.ready ? 0 : 1;
      })
      .catch(() => {
        process.stderr.write(
          'Invalid setup URL. Use an HTTPS OpsKnight origin or /mcp URL, without credentials, query parameters or fragments.\n'
        );
        process.exitCode = 1;
      });
}
