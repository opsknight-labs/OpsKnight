/**
 * Pure Slack health computation, shared by the admin health route and the settings UI.
 *
 * Nothing here talks to Slack or the database: the route gathers the facts (auth.test, stored
 * scopes, the last inbound request) and this module turns them into one honest checklist. Keeping
 * it pure is what lets the UI and tests agree on when "healthy" may be shown.
 */
import {
  SLACK_BOT_EVENTS,
  SLACK_BOT_SCOPES,
  SLACK_OPTIONAL_BOT_SCOPES,
  findMissingOptionalScopes,
  findMissingRequiredScopes,
} from './app-manifest';

/** What each optional scope turns on, in words an admin can act on. */
export const SLACK_OPTIONAL_SCOPE_FEATURES: Record<
  (typeof SLACK_OPTIONAL_BOT_SCOPES)[number],
  string
> = {
  'groups:read': 'See private channels the bot was invited to',
  'groups:write': 'Create private war rooms',
  'groups:history': 'Save pinned notes from private channels',
  'im:read': 'Read direct messages sent to the bot',
  'mpim:read': 'Read group direct messages that include the bot',
  'app_mentions:read': 'Squire answers @OpsKnight mentions',
  'chat:write.customize': 'Squire posts under its own name and avatar',
  'chat:write.public': 'Post to public channels without inviting the bot first',
  'pins:write': 'Pin the incident status card in war rooms',
  'bookmarks:write': 'Bookmark the incident in war-room channels',
  'im:write': 'Page responders with a Slack direct message',
};

export type SlackHealthStatus = 'ok' | 'warn' | 'error';

export interface SlackHealthCheck {
  id:
    | 'connection'
    | 'workspace'
    | 'required_scopes'
    | 'optional_scopes'
    | 'signing_secret'
    | 'inbound'
    | 'squire_chat';
  label: string;
  status: SlackHealthStatus;
  detail: string;
}

export interface SlackScopeHealth {
  missingRequired: string[];
  missingOptional: Array<{ scope: string; enables: string }>;
  /** The stored grant predates the current manifest (some declared scope was never granted). */
  manifestOutdated: boolean;
  /** True only when every scope the manifest declares is granted. */
  healthy: boolean;
}

export function computeSlackScopeHealth(granted: string[] | null | undefined): SlackScopeHealth {
  const missingRequired = findMissingRequiredScopes(granted);
  const missingOptional = findMissingOptionalScopes(granted).map(scope => ({
    scope,
    // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
    enables: SLACK_OPTIONAL_SCOPE_FEATURES[scope],
  }));
  const grantedSet = new Set(granted ?? []);
  const manifestOutdated = SLACK_BOT_SCOPES.some(scope => !grantedSet.has(scope));
  return {
    missingRequired,
    missingOptional,
    manifestOutdated,
    healthy: missingRequired.length === 0 && missingOptional.length === 0,
  };
}

/**
 * Slack DM paging needs `im:write` to open the DM and `users:read.email` to find the person by
 * their verified email. Installs from before DM paging lack `im:write` and stay as they were.
 */
export function slackDmEligibility(granted: string[] | null | undefined): {
  eligible: boolean;
  reason: string | null;
} {
  const set = new Set(granted ?? []);
  if (set.size === 0) return { eligible: false, reason: 'Slack is not connected.' };
  const missing = ['im:write', 'users:read.email'].filter(scope => !set.has(scope));
  if (missing.length === 0) return { eligible: true, reason: null };
  return {
    eligible: false,
    reason: `Your admin needs to update the Slack app and reconnect it to grant ${missing.join(' and ')}.`,
  };
}

export type SlackAuthResult =
  | { ok: true; team?: string | null; teamId?: string | null; botUserId?: string | null }
  | { ok: false; error: string };

export interface SlackHealthInput {
  auth: SlackAuthResult;
  storedWorkspaceId?: string | null;
  storedWorkspaceName?: string | null;
  scopes: string[];
  signingSecretConfigured: boolean;
  lastInboundAt: Date | null;
  squireChatEnabled: boolean;
  now?: Date;
}

export interface SlackHealthReport {
  overall: SlackHealthStatus;
  checks: SlackHealthCheck[];
  scopes: SlackScopeHealth;
  lastInboundAt: string | null;
  squireChatEnabled: boolean;
  dm: { eligible: boolean; reason: string | null };
}

const AUTH_ERROR_TEXT: Record<string, string> = {
  invalid_auth: 'The bot token is invalid. Reconnect Slack.',
  token_revoked: 'The bot token was revoked in Slack. Reconnect Slack.',
  account_inactive: 'The Slack workspace or bot is deactivated. Reactivate it, then reconnect.',
  not_authed: 'No bot token is stored. Connect Slack.',
  not_connected: 'Slack is not connected.',
  ratelimited: 'Slack is rate limiting OpsKnight right now. Try again in a minute.',
  network_error: 'Slack could not be reached from this server. Check outbound network access.',
};

function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function buildSlackHealthReport(input: SlackHealthInput): SlackHealthReport {
  const now = input.now ?? new Date();
  const scopes = computeSlackScopeHealth(input.scopes);
  const checks: SlackHealthCheck[] = [];

  checks.push(
    input.auth.ok
      ? { id: 'connection', label: 'Bot token', status: 'ok', detail: 'Slack accepted the token.' }
      : {
          id: 'connection',
          label: 'Bot token',
          status: 'error',
          detail:
            AUTH_ERROR_TEXT[input.auth.error] ?? `Slack rejected the token (${input.auth.error}).`,
        }
  );

  if (input.auth.ok) {
    const mismatch =
      input.storedWorkspaceId && input.auth.teamId && input.storedWorkspaceId !== input.auth.teamId;
    checks.push({
      id: 'workspace',
      label: 'Workspace',
      status: mismatch ? 'warn' : 'ok',
      detail: mismatch
        ? `The token belongs to ${input.auth.team ?? input.auth.teamId}, not the saved workspace. Reconnect Slack.`
        : `${input.auth.team ?? input.storedWorkspaceName ?? 'Workspace'}${input.auth.teamId ? ` (${input.auth.teamId})` : ''}`,
    });
  }

  checks.push(
    scopes.missingRequired.length === 0
      ? {
          id: 'required_scopes',
          label: 'Required scopes',
          status: 'ok',
          detail: 'Every scope core incident features need is granted.',
        }
      : {
          id: 'required_scopes',
          label: 'Required scopes',
          status: 'error',
          detail: `Missing ${scopes.missingRequired.join(', ')}. Update the app manifest and reconnect.`,
        }
  );

  checks.push(
    scopes.missingOptional.length === 0
      ? {
          id: 'optional_scopes',
          label: 'Feature scopes',
          status: 'ok',
          detail: 'Every optional feature scope is granted.',
        }
      : {
          id: 'optional_scopes',
          label: 'Feature scopes',
          status: 'warn',
          detail: scopes.missingOptional.map(item => `${item.scope}: ${item.enables}`).join('; '),
        }
  );

  checks.push(
    input.signingSecretConfigured
      ? {
          id: 'signing_secret',
          label: 'Signing secret',
          status: 'ok',
          detail: 'Inbound Slack requests are verified.',
        }
      : {
          id: 'signing_secret',
          label: 'Signing secret',
          status: 'error',
          detail: 'No signing secret is saved, so buttons, commands and events are rejected.',
        }
  );

  checks.push(
    input.lastInboundAt
      ? {
          id: 'inbound',
          label: 'Requests from Slack',
          status: 'ok',
          detail: `Last button or command received ${humanDuration(now.getTime() - input.lastInboundAt.getTime())}.`,
        }
      : {
          id: 'inbound',
          label: 'Requests from Slack',
          status: 'warn',
          detail: `No button press or /incident command has reached OpsKnight yet. Check the Interactivity and Event Subscriptions URLs (events: ${SLACK_BOT_EVENTS.join(', ')}).`,
        }
  );

  checks.push(
    input.squireChatEnabled
      ? {
          id: 'squire_chat',
          label: 'Squire in chat',
          status: scopes.missingOptional.some(item => item.scope === 'app_mentions:read')
            ? 'warn'
            : 'ok',
          detail: scopes.missingOptional.some(item => item.scope === 'app_mentions:read')
            ? 'Squire in chat is on, but app_mentions:read is missing, so mentions never arrive.'
            : 'Squire answers @OpsKnight mentions in incident channels.',
        }
      : {
          id: 'squire_chat',
          label: 'Squire in chat',
          status: 'warn',
          detail:
            'Off. Turn on Squire in chat under Settings, Intelligence to answer @OpsKnight mentions.',
        }
  );

  const overall: SlackHealthStatus = checks.some(check => check.status === 'error')
    ? 'error'
    : checks.some(check => check.status === 'warn')
      ? 'warn'
      : 'ok';

  return {
    overall,
    checks,
    scopes,
    lastInboundAt: input.lastInboundAt ? input.lastInboundAt.toISOString() : null,
    squireChatEnabled: input.squireChatEnabled,
    dm: slackDmEligibility(input.scopes),
  };
}

/** Turn a Slack postMessage error code into the fix an admin should make. */
export function describeSlackPostError(
  code: string | null | undefined,
  channelName?: string | null
): string {
  const channel = channelName ? `#${channelName.replace(/^#/, '')}` : 'the channel';
  switch (code) {
    case 'not_in_channel':
      return `Invite @OpsKnight to ${channel} (type /invite @OpsKnight in the channel), then try again.`;
    case 'channel_not_found':
      return `Slack cannot find ${channel}. It may be private without the bot, or deleted. Invite @OpsKnight or refresh the list.`;
    case 'is_archived':
      return `${channel} is archived. Unarchive it or choose another channel.`;
    case 'restricted_action':
    case 'restricted_action_read_only_channel':
      return `Workspace policy blocks posting to ${channel}. Ask a Slack admin to allow the app.`;
    case 'missing_scope':
      return 'The Slack app is missing a scope this needs. Update the app manifest and reconnect.';
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
    case 'not_authed':
      return 'The Slack token is no longer valid. Reconnect Slack.';
    case 'ratelimited':
    case 'rate_limited':
      return 'Slack is rate limiting OpsKnight. Wait a minute and try again.';
    case 'msg_too_long':
    case 'invalid_blocks':
      return 'Slack rejected the message format. Report this to your OpsKnight admin.';
    default:
      return code
        ? `Slack refused the message (${code.replace(/_/g, ' ')}).`
        : 'Slack refused the message.';
  }
}
