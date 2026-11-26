/**
 * Block Kit rendering of the live incident card OpsKnight posts in service Slack channels.
 *
 * Pure functions, unit tested. Every alert-supplied string (title, description, service, notes,
 * names) is escaped, so an alert cannot inject `<!channel>`, user mentions or links. The card is a
 * single coloured attachment holding all blocks, which renders the same in bot posts, chat.update,
 * incoming webhooks and response_url replacements.
 */
import { escapeSlack } from '@/lib/chatops/squire/render';

/** Marks a message as an OpsKnight incident card, so a button click can safely replace it. */
export const SLACK_INCIDENT_CARD_BLOCK_ID = 'opsknight_incident_card';
export const SLACK_INCIDENT_ACTIONS_BLOCK_ID = 'opsknight_incident_actions';

export type SlackCardState = 'triggered' | 'acknowledged' | 'resolved' | 'snoozed' | 'suppressed';

/** What happened, for the thread reply. `updated` is a silent card edit (no reply). */
export type SlackCardEvent =
  | 'triggered'
  | 'acknowledged'
  | 'resolved'
  | 'escalated'
  | 'reopened'
  | 'reassigned'
  | 'snoozed'
  | 'unsnoozed'
  | 'unacknowledged'
  | 'suppressed'
  | 'unsuppressed'
  | 'updated';

export const SLACK_CARD_EVENTS: readonly SlackCardEvent[] = [
  'triggered',
  'acknowledged',
  'resolved',
  'escalated',
  'reopened',
  'reassigned',
  'snoozed',
  'unsnoozed',
  'unacknowledged',
  'suppressed',
  'unsuppressed',
  'updated',
];

export type SlackCardIncident = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency: string;
  priority?: string | null;
  serviceName: string;
  createdAt?: Date | null;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  snoozedUntil?: Date | null;
  /** Zero-based escalation step; level = step + 1. */
  escalationStep?: number | null;
  assigneeName?: string | null;
  /** Slack user ID of the assignee when their email maps to a workspace member. */
  assigneeSlackId?: string | null;
};

export type SlackCardMessage = {
  text: string;
  attachments: Array<{ color: string; fallback: string; blocks: SlackBlock[] }>;
};

export type SlackBlock = { type: string; [key: string]: unknown };

const STATE_STYLE = new Map<SlackCardState, { color: string; emoji: string; label: string }>([
  ['triggered', { color: '#d32f2f', emoji: '🔴', label: 'Triggered' }],
  ['acknowledged', { color: '#f9a825', emoji: '🟠', label: 'Acknowledged' }],
  ['resolved', { color: '#388e3c', emoji: '✅', label: 'Resolved' }],
  ['snoozed', { color: '#757575', emoji: '💤', label: 'Snoozed' }],
  ['suppressed', { color: '#9e9e9e', emoji: '🔕', label: 'Suppressed' }],
]);
const style = (state: SlackCardState) => STATE_STYLE.get(state)!;
const URGENCY_LABEL = new Map([
  ['HIGH', 'High urgency'],
  ['MEDIUM', 'Medium urgency'],
  ['LOW', 'Low urgency'],
]);

export const SNOOZE_OPTIONS_MINUTES = [15, 60, 240] as const;

export function cardStateFromStatus(status: string, fallback?: string): SlackCardState {
  switch (status.toUpperCase()) {
    case 'OPEN':
    case 'TRIGGERED':
      return 'triggered';
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    case 'RESOLVED':
      return 'resolved';
    case 'SNOOZED':
      return 'snoozed';
    case 'SUPPRESSED':
      return 'suppressed';
  }
  if (fallback === 'acknowledged' || fallback === 'resolved') return fallback;
  return 'triggered';
}

export function urgencyLabel(urgency: string): string {
  return URGENCY_LABEL.get(urgency.toUpperCase()) ?? `${titleCase(urgency)} urgency`;
}

export function stateLabel(state: SlackCardState): string {
  return style(state).label;
}

function titleCase(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** "4m", "1h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** Slack renders this in each reader's own time zone; the fallback is UTC. */
export function slackDate(at: Date, format = '{date_short_pretty} at {time}'): string {
  const epoch = Math.floor(at.getTime() / 1000);
  const fallback = `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `<!date^${epoch}^${format}|${fallback}>`;
}

function priorityTag(priority?: string | null): string {
  const value = priority?.trim();
  return value ? `[${value.toUpperCase()}] ` : '';
}

function assigneeText(incident: SlackCardIncident): string {
  if (incident.assigneeSlackId && /^[UW][A-Z0-9]+$/.test(incident.assigneeSlackId)) {
    return `<@${incident.assigneeSlackId}>`;
  }
  return incident.assigneeName ? escapeSlack(incident.assigneeName) : '_Unassigned_';
}

function escalationLevel(incident: SlackCardIncident): number | null {
  const step = incident.escalationStep;
  return typeof step === 'number' && step > 0 ? step + 1 : null;
}

/** Push-notification and screen-reader text: "🔴 [P1] Triggered · payments — title". */
export function cardFallbackText(incident: SlackCardIncident, state: SlackCardState): string {
  return truncate(
    `${style(state).emoji} ${priorityTag(incident.priority)}${style(state).label} · ${escapeSlack(
      oneLine(incident.serviceName)
    )} — ${escapeSlack(oneLine(incident.title))}`,
    300
  );
}

function button(
  text: string,
  actionId: string,
  incidentId: string,
  action: string,
  extra: Record<string, unknown> = {}
): SlackBlock {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id: actionId,
    value: JSON.stringify({ action, incidentId }),
    ...extra,
  };
}

function confirm(title: string, text: string, ok: string, style?: 'danger') {
  return {
    title: { type: 'plain_text', text: title },
    text: { type: 'plain_text', text },
    confirm: { type: 'plain_text', text: ok },
    deny: { type: 'plain_text', text: 'Cancel' },
    ...(style ? { style } : {}),
  };
}

/** Buttons that still apply in this state; resolved cards keep only the link. */
export function cardActionElements(
  incidentId: string,
  state: SlackCardState,
  incidentUrl: string
): SlackBlock[] {
  const elements: SlackBlock[] = [];
  if (state === 'triggered' || state === 'snoozed') {
    elements.push(
      button('Acknowledge', 'ack_incident', incidentId, 'ack', {
        style: 'primary',
      })
    );
  }
  if (state !== 'resolved') {
    elements.push(
      button('Resolve', 'resolve_incident', incidentId, 'resolve', {
        ...(state === 'acknowledged' ? { style: 'primary' } : {}),
        confirm: confirm(
          'Resolve this incident?',
          'Responders stop being paged and the incident is marked resolved.',
          'Resolve'
        ),
      })
    );
  }
  if (state === 'triggered' || state === 'acknowledged') {
    elements.push({
      type: 'static_select',
      action_id: 'snooze_incident',
      placeholder: { type: 'plain_text', text: 'Snooze…', emoji: true },
      options: SNOOZE_OPTIONS_MINUTES.map(minutes => ({
        text: {
          type: 'plain_text',
          text:
            minutes < 60
              ? `${minutes} minutes`
              : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`,
        },
        value: JSON.stringify({ action: 'snooze', incidentId, minutes }),
      })),
    });
  }
  if (state === 'triggered') {
    elements.push(
      button('Escalate', 'escalate_incident', incidentId, 'escalate', {
        confirm: confirm(
          'Escalate now?',
          'This pages the next escalation level right away.',
          'Escalate',
          'danger'
        ),
      })
    );
  }
  if (state !== 'resolved') {
    elements.push(button('Assign to me', 'assign_me_incident', incidentId, 'assign_me'));
  }
  elements.push({
    type: 'button',
    text: { type: 'plain_text', text: 'View in OpsKnight', emoji: true },
    action_id: 'view_incident',
    url: incidentUrl,
  });
  return elements;
}

export function buildIncidentCard(
  incident: SlackCardIncident,
  options: {
    appUrl: string;
    interactive: boolean;
    /** Used only when the status is not one we recognise (legacy presentations). */
    eventType?: string;
    note?: string;
  }
): SlackCardMessage {
  const state = cardStateFromStatus(incident.status, options.eventType);
  const incidentUrl = `${options.appUrl}/incidents/${encodeURIComponent(incident.id)}`;
  const level = escalationLevel(incident);

  const header = truncate(
    oneLine(`${style(state).emoji} ${priorityTag(incident.priority)}${incident.title}`),
    150
  );

  const statusPart =
    state === 'triggered' && level
      ? `*${style(state).label} · Escalated to level ${level}*`
      : `*${style(state).label}*`;
  const context = [
    statusPart,
    urgencyLabel(incident.urgency),
    ...(incident.createdAt ? [`Opened ${slackDate(incident.createdAt)}`] : []),
    // No "open for Xm": the card is not re-rendered as time passes, so it would go stale.
    ...(state === 'resolved' && incident.createdAt && incident.resolvedAt
      ? [
          `Resolved after ${formatDuration(incident.resolvedAt.getTime() - incident.createdAt.getTime())}`,
        ]
      : []),
  ].join('  ·  ');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      block_id: SLACK_INCIDENT_CARD_BLOCK_ID,
      text: { type: 'plain_text', text: header, emoji: true },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: truncate(context, 2900) }] },
  ];

  const description = incident.description?.trim();
  if (description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: escapeSlack(truncate(description, 600)) },
    });
  }

  const fields = [
    { type: 'mrkdwn', text: `*Service*\n${escapeSlack(oneLine(incident.serviceName))}` },
    { type: 'mrkdwn', text: `*Assignee*\n${assigneeText(incident)}` },
    ...(incident.priority?.trim()
      ? [
          {
            type: 'mrkdwn',
            text: `*Priority*\n${escapeSlack(incident.priority.trim().toUpperCase())}`,
          },
        ]
      : []),
    ...(level ? [{ type: 'mrkdwn', text: `*Escalation*\nLevel ${level}` }] : []),
    ...(state === 'snoozed' && incident.snoozedUntil
      ? [
          {
            type: 'mrkdwn',
            text: `*Snoozed until*\n${slackDate(incident.snoozedUntil, '{date_short_pretty} {time}')}`,
          },
        ]
      : []),
  ];
  blocks.push({ type: 'section', fields });

  const note = options.note?.trim();
  if (note) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Note*\n${escapeSlack(truncate(note, 2800))}` },
    });
  }

  blocks.push({
    type: 'actions',
    block_id: SLACK_INCIDENT_ACTIONS_BLOCK_ID,
    elements: options.interactive
      ? cardActionElements(incident.id, state, incidentUrl)
      : [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View in OpsKnight', emoji: true },
            action_id: 'view_incident',
            url: incidentUrl,
          },
        ],
  });

  const text = cardFallbackText(incident, state);
  return { text, attachments: [{ color: style(state).color, fallback: text, blocks }] };
}

/**
 * Short threaded reply for a state change ("✅ Resolved by <@U1> · 23m"). `actor` is a Slack
 * mention or an already-escaped name. Returns null for silent edits.
 */
export function buildThreadReply(
  event: SlackCardEvent,
  incident: SlackCardIncident,
  options: { actor?: string | null; now?: Date } = {}
): string | null {
  const by = options.actor ? ` by ${options.actor}` : '';
  const now = options.now ?? new Date();
  const since = (at?: Date | null) =>
    incident.createdAt
      ? ` · ${formatDuration((at ?? now).getTime() - incident.createdAt.getTime())}`
      : '';
  switch (event) {
    case 'triggered':
      return '🔴 Triggered again';
    case 'acknowledged':
      return `🟠 Acknowledged${by}${since(incident.acknowledgedAt)}`;
    case 'resolved':
      return `✅ Resolved${by}${since(incident.resolvedAt)}`;
    case 'escalated': {
      const level = escalationLevel(incident);
      return `⚡ Escalated${level ? ` to level ${level}` : ''}${by}`;
    }
    case 'reopened':
      return `🔁 Reopened${by}`;
    case 'reassigned':
      return `👤 Assigned to ${assigneeText(incident)}`;
    case 'snoozed':
      return incident.snoozedUntil
        ? `💤 Snoozed until ${slackDate(incident.snoozedUntil, '{time}')}${by}`
        : `💤 Snoozed${by}`;
    case 'unsnoozed':
      return '⏰ Snooze ended, the incident is open again';
    case 'unacknowledged':
      return '↩️ Acknowledgement removed, the incident is open again';
    case 'suppressed':
      return `🔕 Suppressed${by}`;
    case 'unsuppressed':
      return `🔔 No longer suppressed${by}`;
    case 'updated':
      return null;
  }
}

/** Events whose reply is also shown in the channel, because they need someone's attention again. */
export function threadReplyBroadcasts(event: SlackCardEvent): boolean {
  return event === 'reopened' || event === 'escalated' || event === 'triggered';
}

/** True when a clicked Slack message is an OpsKnight incident card (safe to replace in place). */
export function isOpsKnightIncidentCard(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const { blocks, attachments } = message as { blocks?: unknown; attachments?: unknown };
  const all = [
    ...(Array.isArray(blocks) ? blocks : []),
    ...(Array.isArray(attachments)
      ? attachments.flatMap(a =>
          a && Array.isArray((a as { blocks?: unknown }).blocks)
            ? (a as { blocks: unknown[] }).blocks
            : []
        )
      : []),
  ];
  return all.some(
    block => !!block && (block as { block_id?: unknown }).block_id === SLACK_INCIDENT_CARD_BLOCK_ID
  );
}
