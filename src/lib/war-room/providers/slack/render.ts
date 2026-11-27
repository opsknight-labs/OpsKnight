import type { WarRoomProjectionModel } from '../../projection-model';
import { slackContractForKind } from '@/lib/chatops/slack-action-map';
import { escapeSlack } from '@/lib/chatops/squire/render';

function isSlackSupported(action: string): boolean {
  // string to allow ASSIGN_TO_ME compat
  return (
    action === 'ACKNOWLEDGE' ||
    action === 'ASSIGN_SELF' ||
    action === 'ASSIGN_TO_ME' ||
    action === 'RESOLVE' ||
    action === 'TAKE_COMMAND'
  );
}

function formatMeetingLabel(provider: string): string {
  switch (provider) {
    case 'MICROSOFT_TEAMS':
      return 'Teams';
    case 'ZOOM':
      return 'Zoom';
    case 'GOOGLE_MEET':
      return 'Google Meet';
    case 'JITSI':
      return 'Jitsi';
    default:
      return 'Video';
  }
}

const PHASE_EMOJI: Record<WarRoomProjectionModel['phase'], string> = {
  TRIGGERED: '🔴',
  ACKNOWLEDGED: '🟡',
  RESOLVED: '✅',
};

const FRIENDLY = new Map([
  ['OPEN', 'Triggered'],
  ['ACKNOWLEDGED', 'Acknowledged'],
  ['RESOLVED', 'Resolved'],
  ['SNOOZED', 'Snoozed'],
  ['SUPPRESSED', 'Suppressed'],
  ['HIGH', 'High'],
  ['MEDIUM', 'Medium'],
  ['LOW', 'Low'],
]);

/** `OPEN` → `Triggered`, `HIGH` → `High`; unknown values are title-cased. */
export function friendlySlackLabel(value: string): string {
  return (
    FRIENDLY.get(value) ??
    value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
  );
}

/** Slack user ids (U…/W…) for people the card can @mention; resolved from war-room participants. */
export interface SlackWarRoomMentions {
  assignee?: string | null;
  commander?: string | null;
}

const SLACK_USER_ID = /^[UW][A-Z0-9]{2,}$/;

function mention(slackUserId: string | null | undefined, fallbackName: string): string {
  return slackUserId && SLACK_USER_ID.test(slackUserId)
    ? `<@${slackUserId}>`
    : escapeSlack(fallbackName);
}

function button(
  actionId: string,
  label: string,
  value: string,
  extra: Record<string, unknown> = {}
) {
  return {
    type: 'button',
    action_id: actionId,
    text: { type: 'plain_text', text: label },
    value,
    ...extra,
  };
}

function confirmDialog(title: string, text: string, confirm: string) {
  return {
    title: { type: 'plain_text', text: title },
    text: { type: 'mrkdwn', text },
    confirm: { type: 'plain_text', text: confirm },
    deny: { type: 'plain_text', text: 'Cancel' },
  };
}

export function renderSlackWarRoomProjection(
  model: WarRoomProjectionModel,
  mentions: SlackWarRoomMentions = {}
) {
  const { incident } = model;
  const title = escapeSlack(incident.title);
  const createdAt =
    incident.createdAt instanceof Date ? incident.createdAt : new Date(incident.createdAt);
  const openedUnix = Math.floor(createdAt.getTime() / 1000);
  const openedFallback = Number.isFinite(openedUnix) ? createdAt.toISOString() : '';
  const facts = [
    `*Service:* ${escapeSlack(incident.serviceName)}`,
    `*Status:* ${friendlySlackLabel(incident.status)}`,
    `*Urgency:* ${friendlySlackLabel(incident.urgency)}`,
    ...(incident.priority ? [`*Priority:* ${escapeSlack(incident.priority)}`] : []),
  ];
  // The header already carries the title; repeating it here made the card read twice.
  const summary = facts.join(' · ');
  const emoji =
    incident.status === 'SNOOZED'
      ? '💤'
      : incident.status === 'SUPPRESSED'
        ? '🔕'
        : PHASE_EMOJI[model.phase];
  const people = [
    ...(incident.assigneeName
      ? [`*Assignee:* ${mention(mentions.assignee, incident.assigneeName)}`]
      : []),
    ...(Number.isFinite(openedUnix)
      ? [`Opened <!date^${openedUnix}^{ago}|${openedFallback}>`]
      : []),
  ];
  // P1-10: fail-closed — unsupported semantic actions are omitted, never mapped to Resolve.
  const supportedActions = (model.actions as readonly string[]).filter(isSlackSupported);
  const incidentValue = (action: string) => JSON.stringify({ action, incidentId: incident.id });
  const actionButtons = supportedActions
    .map(action => {
      const normalized = action === 'ASSIGN_TO_ME' ? 'ASSIGN_SELF' : action;
      const contract = slackContractForKind(normalized as never);
      if (!contract) return null;
      return button(
        contract.actionId,
        contract.label,
        incidentValue(contract.actionValue),
        normalized === 'ACKNOWLEDGE'
          ? { style: 'primary' }
          : normalized === 'RESOLVE'
            ? {
                confirm: confirmDialog(
                  'Resolve incident?',
                  `This resolves *${title}* for everyone.`,
                  'Resolve'
                ),
              }
            : {}
      );
    })
    .filter(Boolean);
  const isActive = model.phase !== 'RESOLVED';
  const elements = isActive
    ? [
        ...actionButtons,
        // Only an OPEN incident can escalate; the handler re-checks permission and status anyway.
        ...(incident.status === 'OPEN'
          ? [
              button('escalate_incident', 'Escalate', incidentValue('escalate'), {
                style: 'danger',
                confirm: confirmDialog(
                  'Escalate incident?',
                  'This pages the next escalation level now.',
                  'Escalate'
                ),
              }),
            ]
          : []),
        // URL buttons carry no value; the actions route acknowledges them without effect.
        {
          type: 'button',
          action_id: 'view_incident',
          text: { type: 'plain_text', text: 'View' },
          url: incident.url,
        },
      ]
    : [];
  return {
    text: `${emoji} ${friendlySlackLabel(incident.status)}: ${title} (${escapeSlack(incident.serviceName)})`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          // Slack decodes &lt; &gt; &amp; in plain text too, so escaping is safe and keeps it literal.
          text: `${emoji} ${title}`.slice(0, 150),
          emoji: true,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: summary } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [
              ...people,
              `<${incident.url}|Open incident>`,
              '<https://opsknight.com|OpsKnight>',
            ].join(' · '),
          },
        ],
      },
      ...(incident.roles.length
        ? [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: incident.roles
                    .map(
                      role =>
                        `*${escapeSlack(role.shortLabel)}:* ${
                          role.roleKey === 'COMMANDER'
                            ? mention(mentions.commander, role.name)
                            : escapeSlack(role.name)
                        }`
                    )
                    .join(' · '),
                },
              ],
            },
          ]
        : []),
      ...(model.meeting?.joinUrl && isActive
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Meeting Bridge*: <${model.meeting.joinUrl}|Join ${formatMeetingLabel(model.meeting.provider)} Meeting>`,
              },
              accessory: {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: `Join ${formatMeetingLabel(model.meeting.provider)} Meeting`,
                },
                url: model.meeting.joinUrl,
                style: 'primary',
              },
            },
          ]
        : []),
      ...(elements.length ? [{ type: 'actions', elements }] : []),
    ],
  };
}
