/* eslint-disable security/detect-non-literal-fs-filename -- temporary paths created by this test */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

  type Refresher = { refresh: () => Promise<boolean> };
  async function load() {
    const { oauthAuth } = (await import(/* @vite-ignore */ AUTH)) as {
      oauthAuth: (base: string, path: string, log: (message: string) => void) => Refresher;
    };
    return oauthAuth;
  }
  /** A server that treats a replayed, already-rotated token as theft, like OpsKnight does. */
  function rotatingServer() {
    const state = { current: 'r0', revoked: false, issued: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        await new Promise(resolveWait => setTimeout(resolveWait, 30));
        if (init.body.get('refresh_token') !== state.current) {
          state.revoked = true;
          return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        }
        state.issued += 1;
        state.current = `r${state.issued}`;
        return new Response(
          JSON.stringify({
            access_token: `a${state.issued}`,
            refresh_token: state.current,
            expires_in: 300,
          })
        );
      })
    );
    return state;
  }
  const staleLock = (path: string) => {
    writeFileSync(path, 'crashed-owner');
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
  };

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
  it('never removes a lock another process took over after breaking it as stale', async () => {
    const lock = `${config}.lock`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // While this refresh runs, a waiter judged its lock stale and took its own.
        writeFileSync(lock, 'other-owner');
        return new Response(
          JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_in: 300 })
        );
      })
    );
    const oauthAuth = await load();

    await expect(oauthAuth('https://ops.example', config, vi.fn()).refresh()).resolves.toBe(true);

    expect(readFileSync(lock, 'utf8')).toBe('other-owner');
  });

  it('releases its own lock when the refresh is done', async () => {
    rotatingServer();
    const oauthAuth = await load();

    await oauthAuth('https://ops.example', config, vi.fn()).refresh();

    expect(readdirSync(dir)).toEqual(['mcp.json']);
  });

  it('breaks a lock left by a crashed process and leaves nothing behind', async () => {
    const state = rotatingServer();
    staleLock(`${config}.lock`);
    const oauthAuth = await load();

    await expect(oauthAuth('https://ops.example', config, vi.fn()).refresh()).resolves.toBe(true);

    expect(state.issued).toBe(1);
    expect(readdirSync(dir)).toEqual(['mcp.json']);
  });

  it('refreshes one at a time when two bridges find the same stale lock', async () => {
    const state = rotatingServer();
    staleLock(`${config}.lock`);
    const oauthAuth = await load();
    const first = oauthAuth('https://ops.example', config, vi.fn());
    const second = oauthAuth('https://ops.example', config, vi.fn());

    await expect(Promise.all([first.refresh(), second.refresh()])).resolves.toEqual([true, true]);

    expect(state.revoked).toBe(false);
    expect(state.issued).toBe(2);
  });

  it('waits for a live lock instead of breaking it', async () => {
    const state = rotatingServer();
    const lock = `${config}.lock`;
    writeFileSync(lock, 'live-owner');
    const oauthAuth = await load();

    const refreshed = oauthAuth('https://ops.example', config, vi.fn()).refresh();
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
    expect(state.issued).toBe(0);
    expect(existsSync(lock)).toBe(true);

    unlinkSync(lock);
    await expect(refreshed).resolves.toBe(true);
    expect(state.issued).toBe(1);
  });

  it('puts a time limit on the refresh request so a stalled server cannot hold the lock', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
        if (init.signal.aborted) throw new DOMException('timed out', 'TimeoutError');
        return new Response('{}');
      })
    );
    const log = vi.fn();
    const oauthAuth = await load();

    await expect(oauthAuth('https://ops.example', config, log).refresh()).resolves.toBe(false);

    const [limit] = timeout.mock.calls[0] as [number];
    expect(limit).toBeGreaterThanOrEqual(10_000);
    expect(limit).toBeLessThanOrEqual(15_000);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not reach'));
    expect(readdirSync(dir)).toEqual(['mcp.json']);
    timeout.mockRestore();
  });
});
