// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startBridge } from '../helpers/mcp-bridge-process';

/* eslint-disable security/detect-non-literal-fs-filename -- temp directories this test creates */

const PAT = 'okmcp_pat_secret-test-token-0123456789';
const PAGES = 'opsknight://oncall/me/pages';

type Seen = { headers: IncomingMessage['headers']; body: Record<string, unknown>; path: string };
const seen: Seen[] = [];
let behaviour: (seen: Seen, res: ServerResponse) => boolean | void = () => false;
let base = '';
const counts = { rateLimited: 0, rejected: 0, refreshes: 0, listens: 0, polls: 0 };
const issued = { access: 'access-one-secret', refresh: 'refresh-one-secret' };

const json = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const path = req.url ?? '';
  const form = Object.fromEntries(new URLSearchParams(raw));
  if (path === '/.well-known/oauth-authorization-server/oauth/mcp')
    return json(res, 200, {
      issuer: `${base}/oauth/mcp`,
      token_endpoint: `${base}/oauth/mcp/token`,
      registration_endpoint: `${base}/oauth/mcp/register`,
      device_authorization_endpoint: `${base}/oauth/mcp/device_authorization`,
    });
  if (path === '/oauth/mcp/register')
    return json(res, 201, { client_id: 'client-from-dcr', ...JSON.parse(raw) });
  if (path === '/oauth/mcp/device_authorization')
    return json(res, 200, {
      device_code: 'device-code-secret',
      user_code: 'ABCD-EFGH',
      verification_uri: `${base}/oauth/mcp/device`,
      verification_uri_complete: `${base}/oauth/mcp/device?user_code=ABCD-EFGH`,
      expires_in: 600,
      interval: 0,
    });
  if (path === '/oauth/mcp/token') {
    if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      expect(form.client_id).toBe('client-from-dcr');
      return ++counts.polls < 2
        ? json(res, 400, { error: 'authorization_pending' })
        : json(res, 200, {
            access_token: 'device-access-secret',
            refresh_token: 'device-refresh-secret',
            expires_in: 300,
          });
    }
    expect(form).toMatchObject({ grant_type: 'refresh_token', refresh_token: issued.refresh });
    counts.refreshes++;
    issued.access = `access-${counts.refreshes}-secret`;
    issued.refresh = `refresh-${counts.refreshes + 1}-secret`;
    return json(res, 200, {
      access_token: issued.access,
      refresh_token: issued.refresh,
      expires_in: 300,
    });
  }
  const body = JSON.parse(raw);
  const entry = { headers: req.headers, body, path };
  seen.push(entry);
  if (behaviour(entry, res) !== false) return;
  if (body.id === undefined) {
    res.writeHead(202);
    return res.end();
  }
  if (body.method === 'initialize')
    return json(
      res,
      200,
      reply(body.id, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '1' },
      })
    );
  if (body.params?.name === 'stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`
    );
    res.end(`data: ${JSON.stringify(reply(body.id, { content: [], streamed: true }))}\n\n`);
    return;
  }
  const delay = Number(body.params?.arguments?.delay ?? 0);
  setTimeout(() => json(res, 200, reply(body.id, { echo: body.id })), delay);
});

let dir = '';
beforeAll(async () => {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise(done => server.close(done));
});
afterEach(() => {
  seen.length = 0;
  behaviour = () => false;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const call = (id: unknown, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

describe('opsknight-mcp stdio bridge', () => {
  it('forwards JSON with the standard headers and keeps the negotiated version', async () => {
    const bridge = startBridge(['--url', `${base}/`, '--toolsets', 'incidents,oncall'], {
      OPSKNIGHT_TOKEN: PAT,
    });
    bridge.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });
    const init = await bridge.waitFor(m => m.id === 0);
    expect(init.result?.protocolVersion).toBe('2025-11-25');
    expect(init.result?.capabilities).toEqual({ tools: {} });
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send(call('a', 'whoami'));
    bridge.send(call('b', 'incident_get ü'));
    await bridge.waitFor(m => m.id === 'b');
    await bridge.close();
    const [initialize, notification, whoami, unicode] = seen;
    expect(initialize.path).toBe('/mcp');
    expect(initialize.headers).toMatchObject({
      authorization: `Bearer ${PAT}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-method': 'initialize',
      'x-opsknight-toolsets': 'incidents,oncall',
    });
    expect(initialize.headers['mcp-protocol-version']).toBeUndefined();
    expect(notification.headers['mcp-protocol-version']).toBe('2025-11-25');
    expect(whoami.headers).toMatchObject({ 'mcp-method': 'tools/call', 'mcp-name': 'whoami' });
    expect(unicode.headers['mcp-name']).toBe(
      `=?base64?${Buffer.from('incident_get ü').toString('base64')}?=`
    );
  });

  it('uses the 2026-07-28 _meta version and relays every SSE message as one line', async () => {
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: PAT });
    bridge.send({
      ...call(7, 'stream'),
      params: {
        name: 'stream',
        arguments: {},
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      },
    });
    const result = await bridge.waitFor(m => m.id === 7);
    expect(result.result).toEqual({ content: [], streamed: true });
    expect(bridge.received[0].method).toBe('notifications/progress');
    expect(seen[0].headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(await bridge.close()).toBe(0);
  });

  it('keeps ids under concurrency and never prints the token', async () => {
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: PAT });
    const ids = [1, 'two', 3, 'four', 5, 6];
    ids.forEach((id, index) => bridge.send(call(id, 'echo', { delay: (ids.length - index) * 40 })));
    for (const id of ids)
      expect((await bridge.waitFor(m => m.id === id)).result).toEqual({ echo: id });
    // Answers arrive in completion order, not request order: the requests really ran together.
    expect(bridge.received.map(m => m.id)).toEqual([...ids].reverse());
    bridge.child.stdin.write('{oops\n');
    await bridge.waitFor(m => m.error?.code === -32700);
    bridge.send(null);
    await bridge.waitFor(m => m.error?.code === -32600);
    await bridge.close();
    expect(bridge.output()).not.toContain(PAT);
  });

  it('waits out a 429 with Retry-After, then answers', async () => {
    counts.rateLimited = 0;
    behaviour = (_seen, res) =>
      counts.rateLimited++ === 0 ? json(res, 429, {}, { 'retry-after': '1' }) : false;
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: PAT });
    const started = Date.now();
    bridge.send(call(1, 'echo'));
    expect((await bridge.waitFor(m => m.id === 1)).result).toEqual({ echo: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    // A Retry-After beyond the bound is not waited out: a clear error instead.
    behaviour = (_seen, res) => json(res, 429, {}, { 'retry-after': '3600' });
    bridge.send(call(2, 'echo'));
    expect((await bridge.waitFor(m => m.id === 2)).error?.message).toMatch(/HTTP 429/);
    await bridge.close();
  });

  it('turns a 401 with a personal access token and a network failure into JSON-RPC errors', async () => {
    behaviour = (_seen, res) => json(res, 401, { error: 'invalid_token' });
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: PAT });
    bridge.send(call(1, 'echo'));
    expect((await bridge.waitFor(m => m.id === 1)).error?.message).toMatch(/HTTP 401/);
    await bridge.close();
    expect(seen).toHaveLength(1);

    const down = startBridge(['--url', 'http://127.0.0.1:9'], { OPSKNIGHT_TOKEN: PAT });
    down.send(call('x', 'echo'));
    down.send(call('y', 'echo'));
    expect((await down.waitFor(m => m.id === 'x')).error?.message).toMatch(/Could not reach/);
    await down.waitFor(m => m.id === 'y');
    expect(await down.close()).toBe(0);
    expect(down.output()).not.toContain(PAT);
  });

  it('refreshes once after a 401 and stores the rotated refresh token with mode 0600', async () => {
    dir = mkdtempSync(join(tmpdir(), 'okmcp-bridge-'));
    const file = join(dir, 'opsknight', 'mcp.json');
    mkdirSync(join(dir, 'opsknight'));
    issued.refresh = 'refresh-one-secret';
    counts.refreshes = 0;
    writeFileSync(
      file,
      JSON.stringify({
        servers: [
          {
            url: base,
            clientId: 'client-1',
            tokenEndpoint: `${base}/oauth/mcp/token`,
            refreshToken: issued.refresh,
          },
        ],
      })
    );
    // The first access token is refused, as after a server-side revocation of that token.
    behaviour = (s, res) =>
      s.headers.authorization === 'Bearer access-1-secret' ? json(res, 401, {}) : false;
    const bridge = startBridge(['--url', base], { XDG_CONFIG_HOME: dir });
    bridge.send(call(1, 'echo'));
    expect((await bridge.waitFor(m => m.id === 1)).result).toEqual({ echo: 1 });
    expect(counts.refreshes).toBe(2);
    expect(seen.map(s => s.headers.authorization)).toEqual([
      'Bearer access-1-secret',
      'Bearer access-2-secret',
    ]);
    bridge.send(call(2, 'echo'));
    await bridge.waitFor(m => m.id === 2);
    expect(counts.refreshes).toBe(2);
    await bridge.close();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).servers[0].refreshToken).toBe('refresh-3-secret');
    expect(bridge.output()).not.toMatch(/secret/);
  });

  it('signs in with the device flow and saves only a 0600 file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'okmcp-login-'));
    counts.polls = 0;
    const bridge = startBridge(['login', '--url', base, '--scope', 'incidents:read'], {
      XDG_CONFIG_HOME: dir,
    });
    expect(await bridge.exited).toBe(0);
    expect(bridge.stderr()).toContain('ABCD-EFGH');
    expect(bridge.output()).not.toMatch(/secret/);
    const file = join(dir, 'opsknight', 'mcp.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).servers).toEqual([
      {
        url: base,
        clientId: 'client-from-dcr',
        tokenEndpoint: `${base}/oauth/mcp/token`,
        refreshToken: 'device-refresh-secret',
      },
    ]);
  });

  it('refuses plain http except to this machine', async () => {
    for (const url of ['http://ops.example.com', 'ftp://127.0.0.1']) {
      const bridge = startBridge(['--url', url], { OPSKNIGHT_TOKEN: PAT });
      expect(await bridge.exited).toBe(2);
      expect(bridge.stderr()).toMatch(/Refusing/);
    }
    const local = startBridge(['--url', 'http://localhost:1'], { OPSKNIGHT_TOKEN: PAT });
    expect(await local.close()).toBe(0);
  });

  it('pushes pages into a Claude Code channel and reconnects when the stream ends', async () => {
    counts.listens = 0;
    behaviour = (s, res) => {
      if (s.body.method !== 'subscriptions/listen') return false;
      counts.listens++;
      expect(s.headers).toMatchObject({
        'mcp-method': 'subscriptions/listen',
        'mcp-protocol-version': '2026-07-28',
      });
      expect(s.body.params).toMatchObject({ notifications: { resourceSubscriptions: [PAGES] } });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged' })}\n\n`
      );
      // The second stream stays open, as a live one does until its ten minutes are up.
      if (counts.listens > 1) return true;
      res.write(
        `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: PAGES } })}\n\n`
      );
      res.end();
      return true;
    };
    const bridge = startBridge(['--url', base, '--channel'], { OPSKNIGHT_TOKEN: PAT });
    bridge.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });
    const init = await bridge.waitFor(m => m.id === 1);
    expect(init.result?.capabilities).toEqual({
      tools: {},
      experimental: { 'claude/channel': {} },
    });
    expect(init.result?.instructions).toMatch(/channel source="opsknight"/);
    const page = await bridge.waitFor(m => m.method === 'notifications/claude/channel');
    expect(page.params).toMatchObject({ meta: { uri: PAGES } });
    expect(typeof page.params?.content).toBe('string');
    await expect.poll(() => counts.listens, { timeout: 5000 }).toBe(2);
    expect(await bridge.close()).toBe(0);
  });
});
