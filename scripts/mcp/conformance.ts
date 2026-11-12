/**
 * Runs the official MCP conformance suite (@modelcontextprotocol/conformance) against a running
 * OpsKnight. LOCAL or CI databases only.
 *
 *   DATABASE_URL=... ENCRYPTION_KEY=... npm run mcp:conformance -- [--url=http://localhost:3042]
 *     [--out=dir] [--baseline=scripts/mcp/conformance-baseline.yml] [-- <extra suite arguments>]
 *
 * The suite's server mode has no way to authenticate, and OpsKnight's /mcp always needs a bearer.
 * So this harness mints a short-lived personal access token for an active administrator (the
 * production createMcpPersonalToken path, on the same database the server uses), and puts a small
 * local proxy in front of the server that adds `Authorization: Bearer <token>` to requests that
 * carry none. The proxy rewrites Host only when it names the proxy itself, so the suite's own
 * Host/Origin probes (dns-rebinding-protection) reach the server unchanged. The token is revoked
 * when the run ends. Needs Node 22+ for the suite (it uses fs.globSync).
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { loadMcpRuntime } from '@/lib/mcp/auth/config';
import { createMcpPersonalToken } from '@/lib/mcp/auth/personal-tokens';

/** Pinned suite version; bump deliberately and refresh the baseline in the same change. */
export const CONFORMANCE_VERSION = '0.1.16';
const PAT_SCOPES = ['incidents:read', 'services:read', 'schedules:read'];

function argument(name: string) {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test'))
    throw new Error('Conformance runs only against a local *_test database');
}

/** Turns MCP and personal tokens on (disposable database) and mints one for an active administrator. */
async function mintToken() {
  await loadMcpRuntime({ force: true });
  const policy = { enabled: true, patEnabled: true, patAllowedScopes: PAT_SCOPES };
  await prisma.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tokenVersion: true },
  });
  const result = await prisma.$transaction(tx =>
    createMcpPersonalToken(
      tx,
      {
        label: `MCP conformance ${new Date().toISOString()}`,
        scopes: PAT_SCOPES,
        expiresInDays: 1,
      },
      { ...admin, authenticatedAt: Date.now() }
    )
  );
  if (!result.ok) throw new Error(`Could not mint a personal access token: ${result.code}`);
  return result;
}

function startProxy(target: URL, token: string) {
  const server = http.createServer((request, response) => {
    const own = `${(server.address() as { port: number }).port}`;
    const headers = { ...request.headers };
    if (headers.host === `127.0.0.1:${own}`) headers.host = target.host;
    headers.authorization ??= `Bearer ${token}`;
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: request.url,
        method: request.method,
        headers,
      },
      reply => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      }
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  return new Promise<http.Server>(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  assertLocalDatabase();
  const target = new URL(argument('url') ?? 'http://localhost:3042');
  const out = argument('out') ?? 'conformance-results';
  const baseline = argument('baseline') ?? 'scripts/mcp/conformance-baseline.yml';
  const extra = process.argv.includes('--')
    ? process.argv.slice(process.argv.indexOf('--') + 1)
    : [];
  const minted = await mintToken();
  const proxy = await startProxy(target, minted.token);
  const port = (proxy.address() as { port: number }).port;
  mkdirSync(out, { recursive: true });
  try {
    const args = [
      '--yes',
      `@modelcontextprotocol/conformance@${CONFORMANCE_VERSION}`,
      'server',
      '--url',
      `http://127.0.0.1:${port}/mcp`,
      '-o',
      out,
      ...(existsSync(baseline) ? ['--expected-failures', baseline] : []),
      ...extra,
    ];
    const code = await new Promise<number>(resolve =>
      spawn('npx', args, { stdio: 'inherit' }).on('exit', status => resolve(status ?? 1))
    );
    process.exitCode = code;
  } finally {
    proxy.close();
    await prisma.mcpGrant.update({
      where: { id: minted.grantId },
      data: { revokedAt: new Date() },
    });
    await prisma.$disconnect();
  }
}

if (require.main === module)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
