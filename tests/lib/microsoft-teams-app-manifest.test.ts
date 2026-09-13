import { describe, it, expect } from 'vitest';
import {
  buildMicrosoftTeamsAppManifest,
  buildMicrosoftTeamsAppManifestJson,
  findMissingRequiredRscPermissions,
  getMicrosoftTeamsBotMessagingEndpoint,
  MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS,
  MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS,
  MICROSOFT_TEAMS_RSC_PERMISSIONS,
  MICROSOFT_TEAMS_GRAPH_SCOPES,
} from '@/lib/microsoft-teams/app-manifest';

const BASE = 'https://opsknight.example.com';
const BOT_ID = '11111111-1111-1111-1111-111111111111';

describe('Microsoft Teams app manifest', () => {
  it('exposes the bot messaging endpoint via helper (not manifest)', () => {
    expect(getMicrosoftTeamsBotMessagingEndpoint(BASE)).toBe(`${BASE}/api/microsoft-teams/messages`);
  });

  it('tolerates a base URL with a trailing slash', () => {
    expect(getMicrosoftTeamsBotMessagingEndpoint(`${BASE}/`)).toBe(`${BASE}/api/microsoft-teams/messages`);
    const m = buildMicrosoftTeamsAppManifest({ appUrl: `${BASE}/`, botId: BOT_ID });
    expect(m.validDomains).toEqual([new URL(BASE).hostname]);
    expect(m.webApplicationInfo.resource).toBe(`api://${new URL(BASE).hostname}/${BOT_ID}`);
    const mWithUri = buildMicrosoftTeamsAppManifest({ appUrl: `${BASE}/`, botId: BOT_ID, applicationIdUri: `api://${new URL(BASE).hostname}/${BOT_ID}` });
    expect((mWithUri as Record<string, unknown>).webApplicationInfo).toBeDefined();
    expect((mWithUri.webApplicationInfo as { resource: string }).resource).toContain(new URL(BASE).hostname);
  });

  it('keeps destination delivery minimal and makes war-room RSC opt-in', () => {
    // Bot Framework Connector owns message delivery; Graph is only used for discovery.
    expect([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS]).toEqual([
      'ChannelSettings.Read.Group',
    ]);
    expect(MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS).toContain('TeamSettings.Read.Group');
    expect(MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS).toEqual(expect.arrayContaining([
      'Channel.Create.Group',
      'ChannelSettings.ReadWrite.Group',
      'TeamMember.Read.Group',
      'ChannelMember.Read.Group',
      'ChannelMember.ReadWrite.Group',
    ]));
    expect(MICROSOFT_TEAMS_RSC_PERMISSIONS).toHaveLength(7);
  });

  it('declares RSC permissions as Application-scoped in the manifest', () => {
    // Default: only required perms (Phase 1 minimal surface)
    const m = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID });
    const names = (m.authorization.permissions.resourceSpecific as Array<{ name: string }>).map(p => p.name);
    for (const perm of MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS) {
      expect(names).toContain(perm);
    }
    for (const entry of m.authorization.permissions.resourceSpecific as Array<{ type: string }>) {
      expect(entry.type).toBe('Application');
    }
    // No optional perms by default
    for (const opt of MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS) {
      expect(names).not.toContain(opt);
    }
    // Legacy optional flag grants only the historical TeamSettings permission.
    const mFull = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID, includeOptionalPermissions: true });
    const fullNames = (mFull.authorization.permissions.resourceSpecific as Array<{ name: string }>).map(p => p.name);
    expect(fullNames).toContain('TeamSettings.Read.Group');
    expect(fullNames).not.toContain('Channel.Create.Group');
    const warRoom = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID, includeWarRoomPermissions: true });
    const warRoomNames = (warRoom.authorization.permissions.resourceSpecific as Array<{ name: string }>).map(p => p.name);
    expect(warRoomNames).toContain('Channel.Create.Group');
    expect(warRoomNames).not.toContain('ChannelMember.ReadWrite.Group');
    expect(warRoomNames).not.toContain('TeamSettings.Read.Group');
    const all = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID, includeTeamSettingsPermissions: true, includeWarRoomPermissions: true });
    const allNames = (all.authorization.permissions.resourceSpecific as Array<{ name: string }>).map(p => p.name);
    for (const perm of MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS.concat(['TeamSettings.Read.Group', 'Channel.Create.Group'])) {
      expect(allNames).toContain(perm);
    }
  });

  it('always emits webApplicationInfo and permits an Entra Application ID URI override', () => {
    const mDefault = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID });
    expect(mDefault.webApplicationInfo).toEqual({ id: BOT_ID, resource: `api://${new URL(BASE).hostname}/${BOT_ID}` });
    const uri = `api://${new URL(BASE).hostname}/${BOT_ID}`;
    const mWithUri = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID, applicationIdUri: uri });
    expect((mWithUri.webApplicationInfo as { id: string; resource: string }).id).toBe(BOT_ID);
    expect((mWithUri.webApplicationInfo as { id: string; resource: string }).resource).toBe(uri);
  });

  it('advertises only Graph default scope for app-only token', () => {
    expect([...MICROSOFT_TEAMS_GRAPH_SCOPES]).toEqual(['https://graph.microsoft.com/.default']);
  });

  it('embeds non-empty app metadata in the manifest', () => {
    const m = buildMicrosoftTeamsAppManifest({
      appUrl: BASE,
      botId: BOT_ID,
      appName: 'OpsKnight',
      appDescription: 'OpsKnight incident operations for Microsoft Teams',
    });
    expect(m.name.short).toBe('OpsKnight');
    expect(m.description.short.length).toBeGreaterThan(10);
    expect(m.developer.websiteUrl).toBe('https://opsknight.com');
    expect(m.manifestVersion).toBe('1.16');
    expect(m.bots[0].scopes).toEqual(['team']);
    expect(m.bots[0].isNotificationOnly).toBe(true);
    expect(m.bots[0].botId).toBe(BOT_ID);
    expect(m.webApplicationInfo.id).toBe(BOT_ID);
    expect(m.id).toBe(BOT_ID);
    expect((m as unknown as Record<string, unknown>).botsEndpoint).toBeUndefined();
  });

  it('serialises to valid, pretty-printed JSON', () => {
    const json = buildMicrosoftTeamsAppManifestJson({ appUrl: BASE, botId: BOT_ID });
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  ');
    const parsed = JSON.parse(json) as ReturnType<typeof buildMicrosoftTeamsAppManifest>;
    expect(parsed.bots[0].botId).toBe(BOT_ID);
    expect((parsed as unknown as Record<string, unknown>).botsEndpoint).toBeUndefined();
  });
});

describe('findMissingRequiredRscPermissions', () => {
  it('reports nothing when every required permission is granted', () => {
    expect(findMissingRequiredRscPermissions([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS])).toEqual([]);
  });

  it('reports the missing required permission', () => {
    expect(findMissingRequiredRscPermissions([])).toEqual(['ChannelSettings.Read.Group']);
    expect(findMissingRequiredRscPermissions(['TeamSettings.Read.Group'])).toEqual(['ChannelSettings.Read.Group']);
  });

  it('treats absent/empty grant list as everything missing', () => {
    expect(findMissingRequiredRscPermissions(undefined)).toEqual([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS]);
    expect(findMissingRequiredRscPermissions([])).toEqual([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS]);
    expect(findMissingRequiredRscPermissions(null as unknown as string[])).toEqual([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS]);
  });

  it('ignores extra optional permissions and unknown entries', () => {
    expect(
      findMissingRequiredRscPermissions([
        ...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS,
        ...MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS,
        'Unknown.Permission',
      ])
    ).toEqual([]);
  });
});
