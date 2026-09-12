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
  'ChannelSettings.Read.All',
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
  appName?: string;
  appDescription?: string;
}

export function buildMicrosoftTeamsAppManifest({
  appUrl,
  appName = 'OpsKnight',
  appDescription = 'OpsKnight incident operations for Microsoft Teams',
}: MicrosoftTeamsManifestOptions) {
  const origin = appUrl.replace(/\/+$/, '');
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version: '1.0.0',
    id: 'opsknight-teams-phase1',
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
        botId: '${MicrosoftAppId}',
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
      id: '${MicrosoftAppId}',
      resource: `api://${new URL(origin).hostname}/\${MicrosoftAppId}`,
    },
    authorization: {
      permissions: {
        resourceSpecific: MICROSOFT_TEAMS_RSC_PERMISSIONS.map(name => ({ name, type: 'Application' as const })),
      },
    },
    // The only inbound URL the Teams service calls. Keep it stable — the
    // manifest is deployed to AppSource / admin center and cannot be changed
    // without a resubmission.
    botsEndpoint: `${origin}/api/microsoft-teams/messages`,
  };
}

export function buildMicrosoftTeamsAppManifestJson(options: MicrosoftTeamsManifestOptions): string {
  return JSON.stringify(buildMicrosoftTeamsAppManifest(options), null, 2);
}

export function findMissingRequiredRscPermissions(granted: string[] | null | undefined): string[] {
  const set = new Set(granted ?? []);
  return MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS.filter(p => !set.has(p));
}
