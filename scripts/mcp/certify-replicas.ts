/**
 * Two-replica MCP check. LOCAL only; small fixture data, no load. It answers: does MCP stay correct
 * when one assistant's requests land on different application processes sharing one database?
 * Modelled on scripts/dev/certify-dashboard-replicas.ts.
 *
 *   # fresh local DB seeded by scripts/mcp/seed-local.cjs, App URL = replica A
 *   # two production replicas on the same database and secrets, for example:
 *   MCP_ALLOWED_HOSTS=localhost:3043 PORT=3042 node .next/standalone/server.js &
 *   MCP_ALLOWED_HOSTS=localhost:3043 PORT=3043 node .next/standalone/server.js &
 *   npm run mcp:certify:replicas -- --a=http://localhost:3042 --b=http://localhost:3043
 *
 * Replica B is reached under its own Host, so it needs MCP_ALLOWED_HOSTS (the documented setting
 * for a proxy that does not preserve the public Host). Setup (policy, a team, a service and an
 * incident) is written straight to the database; every checked action goes through HTTP.
 *
 * Checks (each prints PASS/FAIL; the script exits non-zero on any FAIL):
 *  1. an OAuth token minted through replica A (registration, consent, code exchange) works on B
 *  2. a change prepared through A is approved on B's review page and committed through B
 *  3. a subscriptions/listen stream held on B sees a change made through A
 *  4. the per-minute quota is shared: once A is over the limit, B refuses the same connection
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { MCP_CATALOG } from '@/lib/mcp/catalog';

const PASSWORD = 'Local-only MCP browser fixture passphrase 2026';
const ADMIN = 'mcp-admin@example.test';
const REVIEWER = 'mcp-reviewer@example.test';
const REDIRECT = 'http://127.0.0.1:8799/callback';
const VERSION = '2026-07-28';

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv: string[]) {
  const read = (name: string) =>
    argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const a = read('a');
  const b = read('b');
  if (!a || !b) throw new Error('--a=<replica A url> and --b=<replica B url> are required');
  for (const base of [a, b])
    if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
      throw new Error('Local replicas only');
  return { a, b };
}

function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test'))
    throw new Error('Replica certification runs only against a local *_test database');
}

/** One JSON-RPC call at the stateless 2026-07-28 revision. */
function rpc(base: string, token: string, method: string, params: Record<string, unknown> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': VERSION,
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'replica-certification', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

/** tools/call result as an object: structuredContent, else the first text block parsed. */
async function callTool(base: string, token: string, name: string, args: Record<string, unknown>) {
  const response = await rpc(base, token, 'tools/call', { name, arguments: args });
  const body = (await response.json().catch(() => null)) as {
    result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> };
  } | null;
  const result = body?.result;
  let value: unknown = result?.structuredContent;
  if (value === undefined && result?.content?.[0]?.text)
    try {
      value = JSON.parse(result.content[0].text);
    } catch {
      value = result.content[0].text;
    }
  return { status: response.status, isError: Boolean(result?.isError), value: value as any };
}

async function signIn(browser: Browser, base: string, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await page.waitForURL(
    url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/api/auth')
  );
  return { context, page };
}

/** Dynamic registration, browser consent and PKCE code exchange, all against one replica. */
async function mintThrough(browser: Browser, base: string, scopes: string[]) {
  const name = `Replica check ${randomBytes(3).toString('hex')}`;
  const registered = await fetch(`${base}/oauth/mcp/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: scopes.join(' '),
    }),
  });
  if (registered.status !== 201)
    throw new Error(`registration on A: ${registered.status} ${await registered.text()}`);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL('/oauth/mcp/authorize', base);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${base}/mcp`,
  }).toString();
  const { context, page } = await signIn(browser, base, ADMIN);
  await page.route(`${REDIRECT}?**`, route => route.fulfill({ status: 200, body: 'ok' }));
  await page.goto(authorize.href);
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.waitForURL(url => url.href.startsWith(REDIRECT));
  const callback = new URL(page.url());
  await context.close();
  if (callback.searchParams.get('state') !== state) throw new Error('state mismatch');
  const exchange = await fetch(`${base}/oauth/mcp/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code: callback.searchParams.get('code') ?? '',
      grant_type: 'authorization_code',
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: `${base}/mcp`,
    }),
  });
  if (exchange.status !== 200) throw new Error(`token exchange on A: ${exchange.status}`);
  return ((await exchange.json()) as { access_token: string }).access_token;
}

/** Collects JSON-RPC messages from one SSE response until `close()`. */
function collect(response: Response) {
  const messages: Array<{ method?: string; params?: Record<string, unknown> }> = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const data = buffer
            .slice(0, index)
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('');
          buffer = buffer.slice(index + 2);
          if (data) messages.push(JSON.parse(data));
        }
      }
    } catch {
      // cancelled
    }
  })();
  return { messages, close: () => reader.cancel().catch(() => undefined) };
}

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function main() {
  assertLocalDatabase();
  const { a, b } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const browser = await chromium.launch();
  const tag = randomBytes(3).toString('hex');
  try {
    // Setup, straight to the database: MCP on with reviewed changes, a fixture to change.
    const scopes = [
      ...new Set([
        'incidents:read',
        'incidents:write',
        ...(MCP_CATALOG.find(op => op.operationId === 'setTeamLead')?.requiredScopes ?? []),
      ]),
    ];
    const policy = {
      enabled: true,
      writesEnabled: true,
      dcrEnabled: true,
      dcrScopes: scopes,
      requestsPerMinute: 600,
    };
    await prisma.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
    const team = await prisma.team.create({ data: { name: `Replica team ${tag}` } });
    const lead = await prisma.user.create({
      data: {
        email: `replica-lead-${tag}@example.test`,
        name: 'Replica lead',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: lead.id } });
    const service = await prisma.service.create({ data: { name: `Replica service ${tag}` } });
    const incident = await prisma.incident.create({
      data: {
        title: `Replica incident ${tag}`,
        serviceId: service.id,
        status: 'OPEN',
        urgency: 'HIGH',
      },
    });
    await sleep(31_000); // the discovery policy memo (30 s) must see the new registration ceiling

    // 1. Token minted through A works on B.
    const token = await mintThrough(browser, a, scopes);
    const listed = await rpc(b, token, 'tools/list');
    const tools = listed.status === 200 ? ((await listed.json()).result?.tools ?? []) : [];
    check(
      'a token minted through replica A is accepted by replica B',
      listed.status === 200 &&
        tools.some((tool: { name: string }) => tool.name === 'operation_prepare'),
      `status ${listed.status}, ${tools.length} tools`
    );

    // 2. Prepared through A, approved and committed through B.
    const revision = (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).revision;
    const prepared = await callTool(a, token, 'operation_prepare', {
      operationId: 'setTeamLead',
      args: { path: { id: team.id }, body: { userId: lead.id }, ifMatch: `"${revision}"` },
      idempotencyKey: randomUUID().replaceAll('-', ''),
    });
    const approvalId: string | undefined = prepared.value?.approvalId;
    check(
      'change prepared through replica A',
      Boolean(approvalId) && !prepared.isError,
      JSON.stringify(prepared.value)?.slice(0, 200)
    );
    if (approvalId) {
      const reviewer = await signIn(browser, b, REVIEWER);
      await reviewer.page.goto(`${b}/settings/integrations/mcp/approvals/operations/${approvalId}`);
      await reviewer.page.getByRole('button', { name: /Approve frozen change/ }).click();
      const approved = await reviewer.page
        .getByText('You approved this change.')
        .waitFor({ timeout: 15_000 })
        .then(
          () => true,
          () => false
        );
      await reviewer.context.close();
      check('the change is approved on replica B review page', approved);
      const committed = await callTool(b, token, 'operation_commit_approved', { approvalId });
      const row = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
      check(
        'the approved change is committed through replica B',
        !committed.isError && row.teamLeadId === lead.id,
        `status ${committed.value?.status ?? committed.status}, teamLeadId ${row.teamLeadId === lead.id ? 'set' : 'unchanged'}`
      );
    }

    // 3. A listen stream on B sees a change made through A.
    const uri = `opsknight://incidents/${incident.id}`;
    const listen = await rpc(b, token, 'subscriptions/listen', {
      notifications: { resourceSubscriptions: [uri] },
    });
    check(
      'replica B accepts a subscriptions/listen stream',
      listen.status === 200,
      `status ${listen.status}`
    );
    if (listen.status === 200) {
      const stream = collect(listen);
      await until(
        () => stream.messages.some(m => m.method === 'notifications/subscriptions/acknowledged'),
        5_000
      );
      await sleep(6_000); // one poll interval, so the stream has its baseline before the change
      const acknowledged = await callTool(a, token, 'incident_acknowledge', {
        path: { id: incident.id },
        body: {},
        idempotencyKey: randomUUID().replaceAll('-', ''),
      });
      check(
        'incident acknowledged through replica A',
        !acknowledged.isError,
        String(acknowledged.status)
      );
      const seen = await until(
        () =>
          stream.messages.some(
            m => m.method === 'notifications/resources/updated' && m.params?.uri === uri
          ),
        15_000
      );
      check('the stream held on replica B sees the change made through A', seen);
      await stream.close();
    }

    // 4. The per-minute quota is one shared window.
    await prisma.mcpPolicy.update({ where: { id: 'default' }, data: { requestsPerMinute: 5 } });
    let limitedOnA: Response | null = null;
    for (let attempt = 0; attempt < 12 && !limitedOnA; attempt += 1) {
      const response = await rpc(a, token, 'tools/call', { name: 'whoami', arguments: {} });
      if (response.status === 429) limitedOnA = response;
      else await response.body?.cancel();
    }
    const retryAfter = Number(limitedOnA?.headers.get('retry-after') ?? 0);
    const onB = await rpc(b, token, 'tools/call', { name: 'whoami', arguments: {} });
    await onB.body?.cancel();
    check(
      'once replica A refuses a connection over its quota, replica B refuses it too',
      Boolean(limitedOnA) && onB.status === 429,
      `A ${limitedOnA ? `429 (Retry-After ${retryAfter}s)` : 'never limited'}, B ${onB.status}`
    );
  } finally {
    await prisma.mcpPolicy
      .update({ where: { id: 'default' }, data: { requestsPerMinute: 600 } })
      .catch(() => undefined);
    await browser.close();
    await prisma.$disconnect();
  }
  const failed = results.filter(result => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
