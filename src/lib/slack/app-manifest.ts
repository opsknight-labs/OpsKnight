/**
 * Single source of truth for what the OpsKnight Slack app needs.
 *
 * The OAuth request, the scope checklist in Settings and the generated app
 * manifest all read from here. Keeping three hand-maintained copies is what let
 * them drift: the checklist reported "all required scopes present" for an
 * install that could not create a war-room channel, and the manifest omitted
 * scopes the OAuth flow asked for, so a reinstall would have failed.
 */

import { SLACK_SHORTCUTS } from '@/lib/slack/shortcut-definitions';

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
  'commands', // Register and receive the /incident slash command
] as const;

/** Scopes that extend coverage; absence degrades rather than breaks. */
export const SLACK_OPTIONAL_BOT_SCOPES = [
  'groups:read', // Private channel support
  'groups:write', // Private war-room channels
  'groups:history', // Pin sync inside private channels
  'im:read',
  'mpim:read',
  'app_mentions:read', // Receive @OpsKnight mentions so Squire can answer in channels
  'chat:write.customize', // Post Squire's messages under its own name and avatar
  'chat:write.public', // Post to public channels without joining them first
  'pins:write', // Pin the incident status card in war rooms
  'bookmarks:write', // Bookmark the incident link in war-room channels
  'im:write', // Open DMs to page on-call responders in Slack
  'im:history', // Read direct messages to the app so Squire can answer them
] as const;

/**
 * Scopes for features most workspaces never use. They are requested with the rest, but their absence is
 * not reported as a gap: each feature explains itself where it is configured.
 */
export const SLACK_ADVANCED_BOT_SCOPES = [
  'usergroups:read', // List user groups when mapping an on-call schedule to one
  'usergroups:write', // Keep a Slack user group in step with who is on call
  'conversations.connect:write', // Invite external people to a war room with Slack Connect
] as const;

/** Lets Squire's messages carry its own name and avatar instead of the app's. */
export const SLACK_CUSTOMIZE_SENDER_SCOPE = 'chat:write.customize';

export const SLACK_BOT_SCOPES: string[] = [
  ...SLACK_REQUIRED_BOT_SCOPES,
  ...SLACK_OPTIONAL_BOT_SCOPES,
  ...SLACK_ADVANCED_BOT_SCOPES,
];

/** Bot events OpsKnight subscribes to. */
export const SLACK_BOT_EVENTS = [
  'reaction_added',
  'app_uninstalled',
  'tokens_revoked',
  // @OpsKnight mentions answered by Squire (off unless Squire is enabled for chat).
  'app_mention',
  // War-room channel capture (Settings → Intelligence); ignored unless that switch is on.
  'message.channels',
  'message.groups',
  // Direct messages to the app, answered by Squire.
  'message.im',
  // The App Home tab (my incidents, who is on call, open incidents).
  'app_home_opened',
] as const;

/** Subcommands the dispatcher actually implements — keeps the hint honest. */
export const SLACK_COMMAND_USAGE_HINT =
  'declare | list [service] | oncall [service] | ack | resolve [summary] | note <text> | who | role <role> @person | page @person|team:<name>|schedule:<name> | assign @person|me | priority P1-P5 | urgency high|medium|low | title <text> | describe <text> | status <message> | runbook | action <text> [@person] [due:date] | actions | postmortem | ask <question> | investigate | help';

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
        always_online: true,
      },
      // Home tab: my incidents, who is on call, open incidents. Messages tab so responders can
      // receive DM pages and reply to the bot.
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      // "Declare incident" from any message, and from the shortcuts menu.
      shortcuts: SLACK_SHORTCUTS.map(shortcut => ({ ...shortcut })),
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

/** Optional scopes the workspace has not granted (features degrade without them). */
export function findMissingOptionalScopes(
  grantedScopes: string[] | undefined | null
): Array<(typeof SLACK_OPTIONAL_BOT_SCOPES)[number]> {
  const granted = new Set(grantedScopes ?? []);
  return SLACK_OPTIONAL_BOT_SCOPES.filter(scope => !granted.has(scope));
}

/** Required scopes the workspace has not granted. */
export function findMissingRequiredScopes(grantedScopes: string[] | undefined | null): string[] {
  const granted = new Set(grantedScopes ?? []);
  return SLACK_REQUIRED_BOT_SCOPES.filter(scope => !granted.has(scope));
}
