/**
 * Single source of truth for the OpsKnight Microsoft Teams app.
 *
 * Mirrors the Slack pattern (`src/lib/slack/app-manifest.ts`): the RSC
 * permission set, the Bot scopes, and the generated app manifest must not
 * drift into three hand-maintained copies.
 *
 * Phase 1 ships with the minimal Resource-Specific Consent (RSC) permission
 * so the first install can list teams/channels and post incident cards.
 * Additional permissions (channel creation / member management) are
 * intentionally deferred to Phase 2 per the spec.
 */

/** RSC permissions the app requests. Keep this minimal for Phase 1. */
export const MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS = [
  'ChannelSettings.Read.Group', // List teams / channels for destination picker
  'ChannelMessage.Send.Group', // Post incident Adaptive Cards to a channel
] as const;

export const MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS = [
  'TeamSettings.Read.Group',
] as const;

export const MICROSOFT_TEAMS_RSC_PERMISSIONS: string[] = [
  ...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS,
  ...MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS,
];

/** Bot delegated / application permissions the server uses via Graph. */
export const MICROSOFT_TEAMS_GRAPH_SCOPES = ['https://graph.microsoft.com/.default'] as const;

export interface MicrosoftTeamsManifestOptions {
  /** Public app origin, e.g. https://opsknight.example.com */
  appUrl: string;
  botId: string; // Entra Application (client) ID — GUID
  appName?: string;
  appDescription?: string;
  manifestId?: string; // GUID for manifest `id` field, defaults to stable placeholder
}

// Messaging endpoint is configured on the Azure Bot resource, not in the manifest.
// Use getMicrosoftTeamsBotMessagingEndpoint() to derive the canonical URL.
export function getMicrosoftTeamsBotMessagingEndpoint(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/microsoft-teams/messages`;
}

export function buildMicrosoftTeamsAppManifest({
  appUrl,
  botId,
  appName = 'OpsKnight',
  appDescription = 'OpsKnight incident operations for Microsoft Teams',
  manifestId = '11111111-1111-1111-1111-111111111111',
}: MicrosoftTeamsManifestOptions) {
  const origin = appUrl.replace(/\/+$/, '');
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version: '1.0.0',
    id: manifestId, // placeholder GUID — replaced by real GUID at packaging time; manifest `id` must be a GUID per Microsoft spec
    packageName: 'com.opsknight.teams',
    developer: {
      name: 'OpsKnight Labs',
      websiteUrl: 'https://opsknight.com',
      privacyUrl: 'https://opsknight.com/privacy',
      termsOfUseUrl: 'https://opsknight.com/terms',
    },
    name: { short: appName, full: appName },
    description: { short: appDescription, full: appDescription },
    icons: { outline: 'outline.png', color: 'color.png' },
    accentColor: '#0f172a',
    bots: [
      {
        botId,
        scopes: ['team', 'groupChat', 'personal'],
        // Single bot endpoint for all Teams activities. The server switches
        // on activity.type: conversationUpdate / invoke (Action.Execute) / message.
        // Never trust tenantId / teamId / userId from raw JSON — auth verifies them.
        commandLists: [],
        isNotificationOnly: false,
      },
    ],
    validDomains: [new URL(origin).hostname],
    webApplicationInfo: {
      id: botId,
      resource: `api://${new URL(origin).hostname}/${botId}`,
    },
    authorization: {
      permissions: {
        resourceSpecific: MICROSOFT_TEAMS_RSC_PERMISSIONS.map(name => ({ name, type: 'Application' as const })),
      },
    },
  };
}

export function buildMicrosoftTeamsAppManifestJson(options: MicrosoftTeamsManifestOptions): string {
  return JSON.stringify(buildMicrosoftTeamsAppManifest(options), null, 2);
}

export function findMissingRequiredRscPermissions(granted: string[] | null | undefined): string[] {
  const set = new Set(granted ?? []);
  return MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS.filter(p => !set.has(p));
}
