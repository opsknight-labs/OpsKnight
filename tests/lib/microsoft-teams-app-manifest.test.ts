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
    expect(m.webApplicationInfo.resource).toContain(new URL(BASE).hostname);
  });

  it('uses the minimal required RSC permissions for Phase 1', () => {
    expect([...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS]).toEqual([
      'ChannelSettings.Read.Group',
      'ChannelMessage.Send.Group',
    ]);
    // Optional permissions are available but not required for Phase 1 card delivery.
    expect(MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS).toContain('TeamSettings.Read.Group');
    // Total RSC set is 2 required + 1 optional = 3
    expect(MICROSOFT_TEAMS_RSC_PERMISSIONS).toHaveLength(3);
  });

  it('declares RSC permissions as Application-scoped in the manifest', () => {
    const m = buildMicrosoftTeamsAppManifest({ appUrl: BASE, botId: BOT_ID });
    const names = m.authorization.permissions.resourceSpecific.map(p => p.name);
    for (const perm of MICROSOFT_TEAMS_RSC_PERMISSIONS) {
      expect(names).toContain(perm);
    }
    for (const entry of m.authorization.permissions.resourceSpecific) {
      expect(entry.type).toBe('Application');
    }
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
    expect(m.bots[0].scopes).toEqual(expect.arrayContaining(['team', 'groupChat']));
    expect(m.bots[0].botId).toBe(BOT_ID);
    expect(m.webApplicationInfo.id).toBe(BOT_ID);
    expect(m.id).toBe(BOT_ID);
    // messaging endpoint is on Azure Bot resource, not in manifest
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
    expect(findMissingRequiredRscPermissions(['ChannelSettings.Read.Group'])).toEqual([
      'ChannelMessage.Send.Group',
    ]);
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
