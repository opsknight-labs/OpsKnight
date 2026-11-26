/**
 * Compact incident card for Slack DMs and the settings "Send test notification" sample.
 *
 * Buttons reuse the channel card's action ids and value shape (`ack_incident`, `resolve_incident`,
 * `{ action, incidentId }`), so /api/slack/actions handles a DM press exactly like a channel press.
 */
import { escapeSlack } from '@/lib/chatops/squire/render';

export type SlackDmEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

export interface SlackDmIncident {
  id: string;
  title: string;
  serviceName: string;
  status: string;
  urgency?: string | null;
  priority?: string | null;
  createdAt: Date;
  assigneeName?: string | null;
  url: string;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Triggered',
  ACKNOWLEDGED: 'Acknowledged',
  SNOOZED: 'Snoozed',
  SUPPRESSED: 'Suppressed',
  RESOLVED: 'Resolved',
};

const EVENT_HEADLINE: Record<SlackDmEventType, string> = {
  triggered: 'You are being paged',
  acknowledged: 'Incident acknowledged',
  resolved: 'Incident resolved',
  updated: 'Incident updated',
};

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** Slack renders this in the reader's own timezone; the fallback is ISO for old clients. */
function slackDate(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000);
  return `<!date^${unix}^{date_short_pretty} at {time}|${date.toISOString()}>`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildSlackDmIncidentMessage(
  incident: SlackDmIncident,
  eventType: SlackDmEventType,
  options: { includeActions?: boolean; note?: string; headline?: string } = {}
): { text: string; blocks: Array<Record<string, unknown>> } {
  const title = escapeSlack(truncate(incident.title, 200));
  const service = escapeSlack(truncate(incident.serviceName, 100));
  const status = STATUS_LABEL[incident.status] ?? titleCase(incident.status);
  const meta = [
    incident.priority ? escapeSlack(incident.priority) : null,
    incident.urgency ? `${titleCase(incident.urgency)} urgency` : null,
    status,
  ]
    .filter(Boolean)
    .join(' · ');

  // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
  const headline = options.headline ?? EVENT_HEADLINE[eventType];
  // Push notifications show `text`; Slack still parses it as mrkdwn, so user text is escaped.
  const text = escapeSlack(
    truncate(`${headline}: ${incident.title} (${incident.serviceName}, ${status})`, 300)
  );

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeSlack(headline)}*\n*<${incident.url}|${title}>*\n${service} · ${meta}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Started ${slackDate(incident.createdAt)} · Assignee: ${
            incident.assigneeName ? escapeSlack(incident.assigneeName) : 'Unassigned'
          }`,
        },
      ],
    },
  ];

  if (options.note) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: escapeSlack(truncate(options.note, 500)) }],
    });
  }

  const resolved = eventType === 'resolved' || incident.status === 'RESOLVED';
  const elements: Array<Record<string, unknown>> = [];
  if (options.includeActions !== false && !resolved) {
    if (incident.status === 'OPEN') {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Acknowledge' },
        style: 'primary',
        value: JSON.stringify({ action: 'ack', incidentId: incident.id }),
        action_id: 'ack_incident',
      });
    }
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Resolve' },
      value: JSON.stringify({ action: 'resolve', incidentId: incident.id }),
      action_id: 'resolve_incident',
      confirm: {
        title: { type: 'plain_text', text: 'Resolve incident?' },
        text: { type: 'plain_text', text: truncate(incident.title, 280) },
        confirm: { type: 'plain_text', text: 'Resolve' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    });
  }
  elements.push({
    type: 'button',
    text: { type: 'plain_text', text: 'Open in OpsKnight' },
    url: incident.url,
    action_id: 'open_incident',
  });
  blocks.push({ type: 'actions', elements });

  return { text, blocks };
}
