import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const { checkMcpSetup } = createRequire(import.meta.url)(
  '../../scripts/mcp/doctor.cjs'
) as typeof import('../../scripts/mcp/doctor.cjs');

test('add URL, automatically register, sign in and revoke without manual client setup', async ({
  page,
  request,
  baseURL,
  browserName,
}) => {
  const origin = baseURL!;
  expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname);
  await page.goto('/login');
  // Use a separate native actor so the expanded matrix preserves the real per-user consent quota.
  await page.getByLabel(/email/i).fill('mcp-reviewer@example.test');
  await page.getByLabel(/^password$/i).fill('Local-only MCP browser fixture passphrase 2026');
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await page.waitForURL(
    url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/api/auth')
  );
  const settingsResponse = await page.goto('/settings/integrations/mcp');
  expect(settingsResponse?.headers()['referrer-policy']).toBe('no-referrer');
  expect(settingsResponse?.headers()['cache-control']).toContain('no-store');
  await page.getByRole('checkbox', { name: /Enable MCP/ }).check();
  await page.getByRole('checkbox', { name: /Allow reviewed routine mutations/ }).uncheck();
  await page
    .getByRole('checkbox', { name: 'Allow assistants to register automatically', exact: true })
    .check();
  await page
    .getByLabel('Maximum scopes for automatically registered assistants')
    .fill('incidents:read');
  await page.getByRole('button', { name: 'Save policy', exact: true }).click();
  await expect(page.getByText('MCP configuration saved', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy Claude Code setup command', exact: true })
  ).toBeVisible();

  await expect
    .poll(async () => {
      const response = await request.get('/.well-known/oauth-authorization-server/oauth/mcp');
      const advertised = await response.json();
      return { endpoint: advertised.registration_endpoint, scopes: advertised.scopes_supported };
    })
    .toEqual({ endpoint: `${origin}/oauth/mcp/register`, scopes: ['incidents:read'] });

  await expect(
    page.getByText('Automatic connections are configured', { exact: true })
  ).toBeVisible();
  expect((await checkMcpSetup(`${origin}/mcp`)).ready).toBe(true);

  const discovery = await request.get('/.well-known/oauth-authorization-server/oauth/mcp');
  const metadata = await discovery.json();
  expect(metadata.registration_endpoint).toBe(`${origin}/oauth/mcp/register`);
  const callback = 'http://127.0.0.1:8799/automatic-callback';
  const name = `Automatic ${browserName} ${Date.now()}`;
  const registered = await request.post(metadata.registration_endpoint, {
    data: {
      client_name: name,
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(registered.status()).toBe(201);
  const client = await registered.json();
  expect(client.scope).toBe('incidents:read');
  expect(client).not.toHaveProperty('client_secret');

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: 'code',
    resource: `${origin}/mcp`,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  await page.route(`${callback}?**`, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Local automatic OAuth callback.',
    })
  );
  // Scope is intentionally absent: the server uses the registered scope ceiling.
  await page.goto(`${metadata.authorization_endpoint}?${query}`);
  await expect(
    page.getByRole('heading', { name: `Allow ${name} to access OpsKnight?`, exact: true })
  ).toBeVisible();
  await expect(page.getByRole('note')).toContainText('not verified by OpsKnight');
  await page.getByRole('button', { name: 'Allow requested scopes', exact: true }).click();
  await page.waitForURL(url => url.origin === new URL(callback).origin);
  const result = new URL(page.url());
  expect(result.searchParams.get('state')).toBe(state);
  expect(result.searchParams.get('iss')).toBe(metadata.issuer);
  const exchanged = await request.post(metadata.token_endpoint, {
    form: {
      client_id: client.client_id,
      code: result.searchParams.get('code')!,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: callback,
      resource: `${origin}/mcp`,
    },
  });
  expect(exchanged.status()).toBe(200);
  const token = await exchanged.json();
  const tools = (target = origin) =>
    request.post(`${target}/mcp`, {
      headers: {
        host: new URL(origin).host,
        authorization: `Bearer ${token.access_token}`,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'automatic-browser-client',
              version: '1',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
    });
  const allowed = await tools();
  expect(allowed.status()).toBe(200);
  const names = (await allowed.json()).result.tools.map((tool: { name: string }) => tool.name);
  expect(names).toContain('incident_search');
  expect(names).not.toContain('incident_resolve');
  const replica = process.env.MCP_E2E_REPLICA_URL;
  if (replica) {
    const mirrored = await tools(replica);
    expect(mirrored.status()).toBe(200);
    const replicaNames = (await mirrored.json()).result.tools.map(
      (tool: { name: string }) => tool.name
    );
    expect(replicaNames).toEqual(names);
  }

  await page.goto('/settings/integrations/mcp');
  await page
    .getByRole('checkbox', { name: 'Allow assistants to register automatically', exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Save policy', exact: true }).click();
  await expect.poll(async () => (await tools()).status()).toBe(401);
  if (replica) expect((await tools(replica)).status()).toBe(401);
  expect(
    await (await request.get('/.well-known/oauth-authorization-server/oauth/mcp')).json()
  ).not.toHaveProperty('registration_endpoint');
});
