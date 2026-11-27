/* eslint-disable security/detect-non-literal-fs-filename -- temporary paths created by this test */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The bridge is plain ESM JavaScript outside the app's type graph, so it is imported by path.
const AUTH = resolve(process.cwd(), 'sdk/mcp-bridge/src/auth.js');

describe('bridge refresh across processes', () => {
  let dir: string;
  let config: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opsknight-bridge-'));
    config = join(dir, 'mcp.json');
    writeFileSync(
      config,
      JSON.stringify({
        servers: [
          {
            url: 'https://ops.example',
            clientId: 'client-1',
            tokenEndpoint: 'https://ops.example/oauth/token',
            refreshToken: 'r0',
          },
        ],
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never sends a refresh token another bridge already rotated', async () => {
    // A server that treats a replayed, already-rotated token as theft, like OpsKnight does.
    let current = 'r0';
    let revoked = false;
    let issued = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        await new Promise(resolveWait => setTimeout(resolveWait, 30));
        if (init.body.get('refresh_token') !== current) {
          revoked = true;
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }
        issued += 1;
        current = `r${issued}`;
        return new Response(
          JSON.stringify({ access_token: `a${issued}`, refresh_token: current, expires_in: 300 })
        );
      })
    );
    const { oauthAuth } = (await import(/* @vite-ignore */ AUTH)) as {
      oauthAuth: (
        base: string,
        path: string,
        log: (message: string) => void
      ) => { refresh: () => Promise<boolean> };
    };
    const log = vi.fn();
    const first = oauthAuth('https://ops.example', config, log);
    const second = oauthAuth('https://ops.example', config, log);

    await expect(Promise.all([first.refresh(), second.refresh()])).resolves.toEqual([true, true]);

    expect(revoked).toBe(false);
    expect(issued).toBe(2);
    expect(JSON.parse(readFileSync(config, 'utf8')).servers[0].refreshToken).toBe('r2');
    expect(log).not.toHaveBeenCalled();
  });
});
