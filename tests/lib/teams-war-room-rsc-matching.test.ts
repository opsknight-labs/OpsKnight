import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTeamsWarRoomRscGrantState } from '@/lib/microsoft-teams/client';

vi.mock('@/lib/microsoft-teams/auth', () => ({
  getMicrosoftTeamsConfig: vi.fn(),
  resolveTenantForCall: vi.fn((a, b) => a || b),
}));

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('getTeamsWarRoomRscGrantState app resolution', () => {
  const mockConfig = {
    config: {
      enabled: true,
      clientId: '14fd6d35-4de1-4311-a438-eb2e34e5802b',
      tenantId: '57307294-7f40-49db-911e-7256a5875c74',
    },
    clientSecret: 'dummy-secret',
  };

  beforeEach(async () => {
    const { getMicrosoftTeamsConfig } = await import('@/lib/microsoft-teams/auth');
    vi.mocked(getMicrosoftTeamsConfig).mockResolvedValue(mockConfig as never);
  });

  it('matches installation when authorization.clientAppId matches clientId even if teamsAppId differs', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          })
        );
      }
      if (url.includes('/installedApps')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [
                {
                  id: 'other-app',
                  teamsAppDefinition: {
                    teamsAppId: 'some-other-id',
                    displayName: 'Other App',
                    authorization: { clientAppId: 'other-client-id' },
                  },
                },
                {
                  id: 'opsknight-app',
                  consentedPermissionSet: {
                    resourceSpecificPermissions: [
                      { permissionValue: 'Channel.Create.Group', permissionType: 'application' },
                      {
                        permissionValue: 'TeamsAppInstallation.Read.Group',
                        permissionType: 'application',
                      },
                    ],
                  },
                  teamsAppDefinition: {
                    teamsAppId: 'f72f51bf-ddb8-42ba-a781-6e848fbdcc72',
                    displayName: 'OpsKnight Custom',
                    authorization: { clientAppId: '14fd6d35-4de1-4311-a438-eb2e34e5802b' },
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    }) as typeof fetch;

    const result = await getTeamsWarRoomRscGrantState({
      tenantId: '57307294-7f40-49db-911e-7256a5875c74',
      teamId: 'team-123',
      requiredPermissions: ['Channel.Create.Group', 'TeamsAppInstallation.Read.Group'],
    });

    expect(result.unknown).toBe(false);
    expect(result.granted).toEqual(['Channel.Create.Group', 'TeamsAppInstallation.Read.Group']);
    expect(result.missing).toEqual([]);
  });

  it('matches installation by displayName OpsKnight when authorization block is absent', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          })
        );
      }
      if (url.includes('/installedApps')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [
                {
                  id: 'opsknight-app',
                  consentedPermissionSet: {
                    resourceSpecificPermissions: [
                      { permissionValue: 'Channel.Create.Group', permissionType: 'application' },
                    ],
                  },
                  teamsAppDefinition: {
                    teamsAppId: 'catalog-guid-xyz',
                    displayName: 'OpsKnight',
                    authorization: null,
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    }) as typeof fetch;

    const result = await getTeamsWarRoomRscGrantState({
      tenantId: '57307294-7f40-49db-911e-7256a5875c74',
      teamId: 'team-123',
      requiredPermissions: ['Channel.Create.Group'],
    });

    expect(result.unknown).toBe(false);
    expect(result.granted).toEqual(['Channel.Create.Group']);
    expect(result.missing).toEqual([]);
  });

  it('marks all permissions missing when app is not installed', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), {
            status: 200,
          })
        );
      }
      if (url.includes('/installedApps')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [
                {
                  id: 'other-app',
                  teamsAppDefinition: {
                    teamsAppId: 'unrelated',
                    displayName: 'Unrelated App',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    }) as typeof fetch;

    const result = await getTeamsWarRoomRscGrantState({
      tenantId: '57307294-7f40-49db-911e-7256a5875c74',
      teamId: 'team-123',
      requiredPermissions: ['Channel.Create.Group'],
    });

    expect(result.unknown).toBe(false);
    expect(result.granted).toEqual([]);
    expect(result.missing).toEqual(['Channel.Create.Group']);
  });
});
