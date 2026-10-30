import { test, expect, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill('Local-only MCP browser fixture passphrase 2026');
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await page.waitForURL(
    url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/api/auth')
  );
}

test('remote request requires a different native reviewer and commits one recoverable execution', async ({
  page,
  browser,
  request,
  baseURL,
  browserName,
}) => {
  const origin = baseURL!;
  expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname);
  await login(page, 'mcp-admin@example.test');
  await page.goto('/settings/integrations/mcp');
  await page.getByRole('checkbox', { name: /Enable MCP/ }).check();
  await page.locator('#main-content').getByText('Advanced', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Allow reviewed routine mutations/ }).check();
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('MCP configuration saved', { exact: true })).toBeVisible();
  await page.getByText('Manual client registration (advanced)', { exact: true }).click();
  const name = `Reviewed ${browserName} ${Date.now()}`;
  const scopes = 'runbooks:execute runbooks:read incidents:read services:read';
  const redirectUri = 'http://127.0.0.1:8799/review-callback';
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Exact redirect URI').fill(redirectUri);
  for (const label of ['Run runbooks after administrator approval', 'View runbooks'])
    await page
      .getByRole('group', { name: 'Allowed scopes' })
      .getByRole('checkbox', { name: label, exact: true })
      .check();
  await page.getByRole('button', { name: 'Register client', exact: true }).click();
  const client = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  const clientId = await client.locator('code').innerText();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = new URL('/oauth/mcp/authorize', origin);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    resource: `${origin}/mcp`,
  }).toString();
  await page.route(`${redirectUri}?**`, route =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'Local callback.' })
  );
  await page.goto(authorize.href);
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.waitForURL(url => url.origin === new URL(redirectUri).origin);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(state);
  expect(callback.searchParams.get('iss')).toBe(`${origin}/oauth/mcp`);
  const exchange = await request.post('/oauth/mcp/token', {
    form: {
      client_id: clientId,
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: `${origin}/mcp`,
    },
  });
  expect(exchange.status()).toBe(200);
  const token = (await exchange.json()).access_token as string;
  const call = async (tool: string, args: Record<string, unknown>) => {
    const response = await request.post('/mcp', {
      headers: {
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': tool,
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: tool,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'local-approval-fixture', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).result;
  };
  const prepared = await call('runbook_prepare_execution', {
    runbookId: 'cmcpbrowserrunbook000000001',
    body: { parameters: {} },
    idempotencyKey: 'browser-prepare',
  });
  expect(prepared.isError, JSON.stringify(prepared)).not.toBe(true);
  const proposal = prepared.structuredContent as {
    previewId: string;
    planDigest: string;
    reviewUrl: string;
  };
  const args = { previewId: proposal.previewId, idempotencyKey: 'browser-execute' };
  const blocked = await call('runbook_execute_approved', args);
  expect(blocked.isError).toBe(true);
  expect(blocked.content[0].text).toBe('MCP_APPROVAL_REQUIRED');
  const reviewer = await browser.newContext({ baseURL: origin });
  try {
    const reviewPage = await reviewer.newPage();
    await login(reviewPage, 'mcp-reviewer@example.test');
    await reviewPage.goto(proposal.reviewUrl);
    await expect(
      reviewPage.getByRole('heading', { name: 'Review requested runbook execution', exact: true })
    ).toBeVisible();
    // Streaming can briefly keep a hidden copy of the page; assert on the rendered main region.
    await expect(
      reviewPage.locator('#main-content').getByText(proposal.planDigest, { exact: true })
    ).toBeVisible();
    await reviewPage.setViewportSize({ width: 390, height: 844 });
    await reviewPage.getByRole('button', { name: 'Approve frozen plan', exact: true }).click();
    await expect(
      reviewPage.locator('#main-content').getByText('Approved', { exact: true })
    ).toBeVisible();
  } finally {
    await reviewer.close();
  }
  const first = await call('runbook_execute_approved', args);
  expect(first.isError, JSON.stringify(first)).not.toBe(true);
  const retry = await call('runbook_execute_approved', args);
  expect(retry.structuredContent.executionId).toBe(first.structuredContent.executionId);
  const duplicate = await call('runbook_execute_approved', {
    ...args,
    idempotencyKey: 'different-key',
  });
  expect(duplicate.isError).toBe(true);
});
