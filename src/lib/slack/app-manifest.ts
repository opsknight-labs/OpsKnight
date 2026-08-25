/**
 * Single source of truth for what the OpsKnight Slack app needs.
 *
 * The OAuth request, the scope checklist in Settings and the generated app
 * manifest all read from here. Keeping three hand-maintained copies is what let
 * them drift: the checklist reported "all required scopes present" for an
 * install that could not create a war-room channel, and the manifest omitted
 * scopes the OAuth flow asked for, so a reinstall would have failed.
 */

/** Scopes without which core incident features break. */
export const SLACK_REQUIRED_BOT_SCOPES = [
  'chat:write', // Post incident cards and war-room updates
  'channels:read', // List channels for service configuration
  'channels:join', // Join channels the bot was not invited to
  'channels:manage', // Create the war-room channel, set topic, archive
  'channels:history', // Read a pinned message so it can be saved as a note
  'reactions:read', // Receive reaction_added for 📌 pin sync
  'users:read', // Resolve Slack users for attribution
  'users:read.email', // Match Slack users to OpsKnight accounts (auto-invite)
] as const;

/** Scopes that extend coverage; absence degrades rather than breaks. */
export const SLACK_OPTIONAL_BOT_SCOPES = [
  'groups:read', // Private channel support
  'groups:write', // Private war-room channels
  'groups:history', // Pin sync inside private channels
  'im:read',
  'mpim:read',
] as const;

export const SLACK_BOT_SCOPES: string[] = [
  ...SLACK_REQUIRED_BOT_SCOPES,
  ...SLACK_OPTIONAL_BOT_SCOPES,
];

/** Bot events OpsKnight subscribes to. */
export const SLACK_BOT_EVENTS = [
  'reaction_added',
  'app_uninstalled',
  'tokens_revoked',
] as const;

/** Subcommands the dispatcher actually implements — keeps the hint honest. */
export const SLACK_COMMAND_USAGE_HINT =
  'ack | resolve [summary] | note <message> | who | postmortem | help';

export interface SlackManifestOptions {
  /** Public base URL, e.g. https://opsknight.example.com */
  baseUrl: string;
  appName?: string;
  botDisplayName?: string;
}

/**
 * Build a Slack app manifest describing every permission and endpoint OpsKnight
 * needs. Slack can create an app directly from this, which configures scopes,
 * Event Subscriptions, interactivity and the slash command in one step instead
 * of a dozen manual toggles.
 */
export function buildSlackAppManifest({
  baseUrl,
  appName = 'OpsKnight',
  botDisplayName = 'OpsKnight',
}: SlackManifestOptions) {
  const origin = baseUrl.replace(/\/+$/, '');

  return {
    display_information: {
      name: appName,
      description: 'OpsKnight Incident Management',
      background_color: '#202d3b',
    },
    features: {
      bot_user: {
        display_name: botDisplayName,
        always_online: false,
      },
      slash_commands: [
        {
          command: '/incident',
          url: `${origin}/api/slack/commands`,
          description: 'Manage OpsKnight incidents from Slack',
          usage_hint: SLACK_COMMAND_USAGE_HINT,
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      redirect_urls: [`${origin}/api/slack/oauth/callback`],
      scopes: {
        bot: SLACK_BOT_SCOPES,
      },
    },
    settings: {
      // Emoji pin sync. Separate from interactivity below — buttons can work
      // while events silently do not, which is easy to miss.
      event_subscriptions: {
        request_url: `${origin}/api/slack/events`,
        bot_events: [...SLACK_BOT_EVENTS],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${origin}/api/slack/actions`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Pretty-printed manifest, ready to paste into Slack. */
export function buildSlackAppManifestJson(options: SlackManifestOptions): string {
  return JSON.stringify(buildSlackAppManifest(options), null, 2);
}

/** Required scopes the workspace has not granted. */
export function findMissingRequiredScopes(grantedScopes: string[] | undefined | null): string[] {
  const granted = new Set(grantedScopes ?? []);
  return SLACK_REQUIRED_BOT_SCOPES.filter(scope => !granted.has(scope));
}
