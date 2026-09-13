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

/** RSC permissions the app requests. Keep this minimal for Phase 1.
 * Incident cards are posted via Bot Framework Connector (serviceUrl/Bot token),
 * not via Graph RSC `ChannelMessage.Send.Group`. Only ChannelSettings.Read.Group
 * is required for Teams/channel discovery. */
export const MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS = [
  'ChannelSettings.Read.Group', // List teams / channels for destination picker (Graph)
] as const;
export const MICROSOFT_TEAMS_MANIFEST_VERSION = '1.2.0';

export const MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS = [
  'TeamSettings.Read.Group',
  // Phase 3 war rooms. These remain opt-in so installations that only send
  // destination alerts retain the Phase 1 least-privilege consent surface.
  'Channel.Create.Group',
  'ChannelSettings.ReadWrite.Group',
  'TeamMember.Read.Group',
  'ChannelMember.Read.Group',
  'ChannelMember.ReadWrite.Group',
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
  manifestId?: string; // GUID for manifest `id`; defaults to the stable Bot app ID
  /** Entra Application ID URI (e.g. `api://opsknight.example.com/<appId>`).
   * Defaults to the conventional, stable URI derived from the public app host. */
  applicationIdUri?: string;
  /** When true, include optional RSC permissions (TeamSettings.Read.Group).
   * Defaults to false — Phase 1 minimal surface; enable only when the
   * corresponding capability (e.g. member management) is active. */
  includeOptionalPermissions?: boolean;
}

// Messaging endpoint is configured on the Azure Bot resource, not in the manifest.
// Use getMicrosoftTeamsBotMessagingEndpoint() to derive the canonical URL.
export function getMicrosoftTeamsBotMessagingEndpoint(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/microsoft-teams/messages`;
}

export type MicrosoftTeamsAppManifest = {
  $schema: string;
  manifestVersion: string;
  version: string;
  id: string;
  packageName: string;
  developer: { name: string; websiteUrl: string; privacyUrl: string; termsOfUseUrl: string };
  name: { short: string; full: string };
  description: { short: string; full: string };
  icons: { outline: string; color: string };
  accentColor: string;
  bots: Array<{ botId: string; scopes: string[]; commandLists: unknown[]; isNotificationOnly: boolean }>;
  validDomains: string[];
  authorization: {
    permissions: {
      resourceSpecific: Array<{ name: string; type: 'Application' }>;
    };
  };
  webApplicationInfo: { id: string; resource: string };
};

export function buildMicrosoftTeamsAppManifest({
  appUrl,
  botId,
  appName = 'OpsKnight',
  appDescription = 'OpsKnight incident operations for Microsoft Teams',
  manifestId = botId,
  applicationIdUri,
  includeOptionalPermissions = false,
}: MicrosoftTeamsManifestOptions): MicrosoftTeamsAppManifest {
  const origin = appUrl.replace(/\/+$/, '');
  const rscPermissions = includeOptionalPermissions
    ? MICROSOFT_TEAMS_RSC_PERMISSIONS
    : [...MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS];
  const manifest: MicrosoftTeamsAppManifest = {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version: MICROSOFT_TEAMS_MANIFEST_VERSION,
    id: manifestId,
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
        scopes: ['team'],
        commandLists: [],
        isNotificationOnly: true,
      },
    ],
    validDomains: [new URL(origin).hostname],
    authorization: {
      permissions: {
        resourceSpecific: rscPermissions.map(name => ({ name, type: 'Application' as const })),
      },
    },
    // Required for resource-specific consent manifests. Operators can override
    // this when their Entra registration uses a different Application ID URI.
    webApplicationInfo: {
      id: botId,
      resource: applicationIdUri?.trim() || `api://${new URL(origin).hostname}/${botId}`,
    },
  };
  return manifest;
}

export function buildMicrosoftTeamsAppManifestJson(options: MicrosoftTeamsManifestOptions): string {
  return JSON.stringify(buildMicrosoftTeamsAppManifest(options), null, 2);
}

export function findMissingRequiredRscPermissions(granted: string[] | null | undefined): string[] {
  const set = new Set(granted ?? []);
  return MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS.filter(p => !set.has(p));
}
