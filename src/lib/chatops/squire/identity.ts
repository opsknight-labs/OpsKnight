import 'server-only';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import { getSlackBotScopes } from '@/lib/slack';
import { SLACK_CUSTOMIZE_SENDER_SCOPE } from '@/lib/slack/app-manifest';
import { chatBaseUrl } from './switches';
import { escapeSlack } from './render';

/**
 * Who a Squire message in Slack or Teams says it is from.
 *
 * Slack lets a bot post under another name and avatar only with the optional `chat:write.customize` scope,
 * so with it Squire's messages carry the configured Squire name and avatar. Without it, and always in
 * Teams (a bot cannot change its sender there), each Squire message starts with a compact header naming
 * Squire instead. System messages (alerts, paging, the war-room card) never use this and stay "OpsKnight".
 */

export const SQUIRE_AVATAR_PATH = '/squire/squire-avatar.png';
const NAME_MAX = 40;

export interface SquireIdentity {
  name: string;
  avatarUrl: string;
  /**
   * Whether chat clients can fetch the avatar (a public https origin). Slack rejects a whole message whose
   * block image it cannot download, so the image is left out otherwise.
   */
  avatarReachable: boolean;
}

/** The administrator's Squire name, made safe for a display name; markup characters are dropped. */
export function squireIdentityFor(
  name: string | null | undefined,
  baseUrl: string
): SquireIdentity {
  const base = baseUrl.replace(/\/+$/, '');
  const clean =
    (name ?? '')
      .replace(/[\u0000-\u001f\u007f<>&*_~`|[\]#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX) || 'Squire';
  let reachable = false;
  try {
    const url = new URL(base);
    reachable =
      url.protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname);
  } catch {
    reachable = false;
  }
  return { name: clean, avatarUrl: `${base}${SQUIRE_AVATAR_PATH}`, avatarReachable: reachable };
}

/** The configured identity; falls back to "Squire" when settings cannot be read. */
export async function loadSquireIdentity(): Promise<SquireIdentity> {
  let name: string | undefined;
  try {
    name = (await getAiSettings()).squireName;
  } catch {
    name = undefined;
  }
  return squireIdentityFor(name, chatBaseUrl());
}

/** Whether the Slack installation used for this service granted `chat:write.customize`. */
export async function slackCanCustomizeSender(serviceId?: string | null): Promise<boolean> {
  try {
    return (await getSlackBotScopes(serviceId ?? undefined)).includes(SLACK_CUSTOMIZE_SENDER_SCOPE);
  } catch {
    return false;
  }
}

export const SLACK_SQUIRE_HEADER_BLOCK_ID = 'squire_identity';

/** "<avatar> Squire · OpsKnight assistant", as a Block Kit context block. */
export function slackSquireHeaderBlock(identity: SquireIdentity): Record<string, unknown> {
  return {
    type: 'context',
    block_id: SLACK_SQUIRE_HEADER_BLOCK_ID,
    elements: [
      ...(identity.avatarReachable
        ? [{ type: 'image', image_url: identity.avatarUrl, alt_text: identity.name }]
        : []),
      { type: 'mrkdwn', text: `*${escapeSlack(identity.name)}* · OpsKnight assistant` },
    ],
  };
}

/** Blocks of a Squire message: the header leads them unless Slack shows Squire as the sender. */
export function slackSquireBlocks(
  blocks: Record<string, unknown>[],
  identity: SquireIdentity,
  canCustomize: boolean
): Record<string, unknown>[] {
  return canCustomize ? blocks : [slackSquireHeaderBlock(identity), ...blocks];
}

/**
 * `chat.postMessage` fields that post as Squire. Only for a new message: `chat.update` cannot change the
 * sender, and an edited message keeps the one it was posted with.
 */
export function slackSquireSender(
  identity: SquireIdentity,
  canCustomize: boolean
): { username?: string; icon_url?: string } {
  return canCustomize ? { username: identity.name, icon_url: identity.avatarUrl } : {};
}

/** The same header as an Adaptive Card column set (Teams always shows the app as the sender). */
export function teamsSquireHeader(identity: SquireIdentity): Record<string, unknown> {
  return {
    type: 'ColumnSet',
    id: 'squire_identity',
    columns: [
      ...(identity.avatarReachable
        ? [
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'Image',
                  url: identity.avatarUrl,
                  size: 'Small',
                  style: 'Person',
                  altText: identity.name,
                },
              ],
            },
          ]
        : []),
      {
        type: 'Column',
        width: 'stretch',
        verticalContentAlignment: 'Center',
        items: [
          {
            type: 'TextBlock',
            wrap: true,
            text: `**${identity.name}** · OpsKnight assistant`,
          },
        ],
      },
    ],
  };
}

export function withTeamsSquireHeader(
  card: Record<string, unknown>,
  identity: SquireIdentity
): Record<string, unknown> {
  const body = Array.isArray(card.body) ? (card.body as unknown[]) : [];
  return { ...card, body: [teamsSquireHeader(identity), ...body] };
}
