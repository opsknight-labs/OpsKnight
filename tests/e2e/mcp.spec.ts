import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

test('native MCP settings, PKCE consent, scoped call and revocation on desktop/mobile', async ({
  page,
  request,
  browserName,
  baseURL,
}) => {
  const origin = baseURL!;
  // This suite is restricted to owned local fixtures; it never accepts live credentials.
  expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('mcp-admin@example.test');
  await page.getByLabel(/^password$/i).fill('Local-only MCP browser fixture passphrase 2026');
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await page.waitForURL(
    url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/api/auth')
  );
  await page.goto('/settings/integrations/mcp');
  await expect(page.getByRole('heading', { name: 'MCP integration', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Enable MCP/ }).check();
  await page.getByRole('checkbox', { name: /Allow reviewed routine mutations/ }).uncheck();
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByRole('region', { name: 'Connection status' })).toContainText(
    'Status: Enabled'
  );

  const name = `Local ${browserName} ${Date.now()}`;
  const redirectUri = 'http://127.0.0.1:8799/callback';
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Exact redirect URI').fill(redirectUri);
  await page.getByLabel(/Allowed scopes/).fill('incidents:read services:read schedules:read');
  await page.getByRole('button', { name: 'Register client', exact: true }).click();
  const clientArticle = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(clientArticle).toHaveCount(1);
  const clientId = await clientArticle.locator('code').innerText();

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL('/oauth/mcp/authorize', origin);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'incidents:read',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${origin}/mcp`,
  }).toString();
  await page.route(`${redirectUri}?**`, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'Local OAuth callback received.',
    })
  );
  await page.goto(authorize.href);
  await expect(
    page.getByRole('heading', { name: `Allow ${name} to access OpsKnight?` })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Allow requested scopes', exact: true }).click();
  await page.waitForURL(url => url.origin === new URL(redirectUri).origin);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(state);
  expect(callback.searchParams.get('iss')).toBe(`${origin}/oauth/mcp`);
  const code = callback.searchParams.get('code');
  expect(code).toBeTruthy();
  const exchange = await request.post('/oauth/mcp/token', {
    form: {
      client_id: clientId,
      code: code!,
      grant_type: 'authorization_code',
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: `${origin}/mcp`,
    },
  });
  expect(exchange.status()).toBe(200);
  const token = (await exchange.json()) as { access_token: string };
  const rpc = (method: string, params: Record<string, unknown> = {}) =>
    request.post('/mcp', {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'local-browser-fixture', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
    });
  const tools = await rpc('tools/list');
  expect(tools.status()).toBe(200);
  const list = await tools.json();
  expect(list.result.tools.some((tool: { name: string }) => tool.name === 'incident_search')).toBe(
    true
  );
  expect(list.result.tools.some((tool: { name: string }) => tool.name === 'incident_resolve')).toBe(
    false
  );
  const read = await rpc('tools/call', {
    name: 'incident_search',
    arguments: { query: { limit: 5 } },
  });
  expect(read.status()).toBe(200);
  expect((await read.json()).result.isError).not.toBe(true);

  // The client allows services:read, but this consent granted incidents:read only.
  // A guessed operation must enforce the grant even through generic invocation.
  const forbidden = await rpc('tools/call', {
    name: 'call_operation',
    arguments: { operationId: 'listServices', args: { query: { limit: 5 } } },
  });
  expect(forbidden.status()).toBe(200);
  const denial = (await forbidden.json()).result;
  expect(denial.isError).toBe(true);
  expect(denial.content[0].text).toBe('MCP_OPERATION_FORBIDDEN');

  await page.goto('/settings/integrations/mcp');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save policy' })).toBeVisible();
  const grantSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Client grants', exact: true }) });
  const grant = grantSection.locator('article').filter({ hasText: name });
  await grant.getByRole('button', { name: 'Revoke grant', exact: true }).click();
  await expect(grant.getByText('Revoked', { exact: true })).toBeVisible();
  expect((await rpc('tools/list')).status()).toBe(401);
});
