import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTeamsGrantedRscPermissions } from '@/lib/microsoft-teams/client';

const installations = Array.from({ length: 10 }, (_, i) => ({
  teamId: `team-${i}`,
  teamName: `Team ${i}`,
}));

vi.mock('@/lib/microsoft-teams/auth', () => ({
  getMicrosoftTeamsConfig: vi.fn(async () => ({
    config: { enabled: true, clientId: 'rsc-probe-client', tenantId: 'rsc-probe-tenant' },
    clientSecret: 'secret',
  })),
  resolveTenantForCall: vi.fn((a, b) => a || b),
}));

vi.mock('@/lib/prisma', () => ({
  default: { microsoftTeamsInstallation: { findMany: vi.fn(async () => installations) } },
}));

const realFetch = global.fetch;
const tokenResponse = () =>
  new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });

describe('getTeamsGrantedRscPermissions probe scheduling', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('probes installations concurrently (bounded) and keeps installation order', async () => {
    let inFlight = 0;
    let peak = 0;
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/oauth2/v2.0/token')) return tokenResponse();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as never;

    const state = await getTeamsGrantedRscPermissions();

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(state.unknown).toBe(false);
    expect(state.installations.map(s => s.teamId)).toEqual(installations.map(i => i.teamId));
  });

  it('marks a hung probe unknown at the deadline instead of blocking', async () => {
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2/v2.0/token')) return tokenResponse();
      if (url.includes('team-9')) {
        // Never answers; only the deadline releases it.
        await new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        );
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as never;

    const pending = getTeamsGrantedRscPermissions();
    await vi.waitFor(() =>
      expect(vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes('team-9'))).toBe(
        true
      )
    );
    controllers.at(-1)!.abort(new Error('deadline'));
    const state = await pending;

    expect(state.unknown).toBe(true);
    expect(state.installations).toHaveLength(installations.length);
    expect(state.installations.find(s => s.teamId === 'team-9')?.error).toBe('GRAPH_TIMEOUT');
    expect(state.installations.filter(s => !s.unknown)).toHaveLength(installations.length - 1);
  });
});
