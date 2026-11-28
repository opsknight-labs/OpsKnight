import type { IncidentStatus } from '@prisma/client';
import { incidentStatusLabel } from '@/lib/incident-status';

/**
 * Conversational surface of the Teams bot (manifest 1.4.0+): command parsing and the
 * small help / status cards the messages route answers directly. Everything else
 * (ask, investigate, ack, resolve, free text) goes to Squire.
 */

export type TeamsConversationKind = 'personal' | 'groupChat' | 'channel' | 'unknown';

/** Teams sets `conversation.conversationType`; older or unusual payloads may omit it. */
export function teamsConversationKind(conversation: unknown): TeamsConversationKind {
  const type =
    conversation && typeof conversation === 'object'
      ? (conversation as { conversationType?: unknown }).conversationType
      : undefined;
  if (type === 'personal' || type === 'groupChat' || type === 'channel') return type;
  return 'unknown';
}

export type TeamsBotCommand = { kind: 'help' } | { kind: 'status' } | { kind: 'squire' };

/** First word after the @mention decides the command; empty text means help. */
export function parseTeamsBotCommand(text: unknown): TeamsBotCommand {
  const cleaned = (typeof text === 'string' ? text : '')
    .slice(0, 4_000)
    .replace(/<at>[^<]{0,200}<\/at>/gi, ' ')
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return { kind: 'help' };
  const first = cleaned.split(/\s+/)[0].replace(/^\//, '');
  if (first === 'help' || first === '?') return { kind: 'help' };
  if (first === 'status' && cleaned.split(/\s+/).length === 1) return { kind: 'status' };
  return { kind: 'squire' };
}

/** Neutralise Teams markdown and HTML in user or alert text placed in a TextBlock. */
export function escapeTeamsMarkdown(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]~]/g, ch => `\\${ch}`)
    .replace(/^(\s*)([#+-]|\d+\.)(?=\s)/gm, '$1\\$2');
}

const card = (body: unknown[], actions?: unknown[]) => ({
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.5',
  body,
  ...(actions?.length ? { actions } : {}),
});

export function buildTeamsHelpCard(input: {
  squireEnabled: boolean;
  conversation: TeamsConversationKind;
}): Record<string, unknown> {
  const lines = input.squireEnabled
    ? [
        '- **ask** _question_ — ask Squire about this incident or your services',
        '- **investigate** — Squire looks into the incident for this channel',
        '- **ack** / **resolve** — Squire prepares the action for you to confirm',
        '- **status** — the current state of this channel’s incident',
      ]
    : [
        '- **status** — the current state of this channel’s incident',
        '- Use the buttons on incident cards to acknowledge or resolve.',
      ];
  const where =
    input.conversation === 'channel' || input.conversation === 'unknown'
      ? 'Mention @OpsKnight followed by a command.'
      : 'Commands and Squire answers work in an incident channel: mention @OpsKnight there. Direct messages are not answered yet.';
  const body: unknown[] = [
    { type: 'TextBlock', text: 'What OpsKnight can do here', weight: 'Bolder', wrap: true },
    { type: 'TextBlock', text: where, wrap: true, isSubtle: true },
    { type: 'TextBlock', text: lines.join('\n'), wrap: true },
  ];
  if (!input.squireEnabled) {
    body.push({
      type: 'TextBlock',
      wrap: true,
      color: 'Warning',
      text: 'Squire in chat is turned off. An OpsKnight admin can turn it on in Settings → Intelligence → AI.',
    });
  }
  return card(body);
}

export function buildTeamsStatusCard(
  incident: {
    id: string;
    title: string;
    status: IncidentStatus;
    urgency: string;
    serviceName: string | null;
  } | null,
  baseUrl: string
): Record<string, unknown> {
  if (!incident) {
    return card([
      {
        type: 'TextBlock',
        wrap: true,
        text: 'This conversation isn’t linked to an incident. Use **status** in an incident’s war-room channel, or open OpsKnight to see all incidents.',
      },
    ]);
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/incidents/${encodeURIComponent(incident.id)}`;
  return card(
    [
      {
        type: 'TextBlock',
        text: escapeTeamsMarkdown(incident.title),
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Status', value: incidentStatusLabel(incident.status) },
          {
            title: 'Urgency',
            value:
              incident.urgency === 'HIGH' ? 'High' : incident.urgency === 'LOW' ? 'Low' : 'Medium',
          },
          ...(incident.serviceName
            ? [{ title: 'Service', value: escapeTeamsMarkdown(incident.serviceName) }]
            : []),
        ],
      },
    ],
    [{ type: 'Action.OpenUrl', title: 'Open in OpsKnight', url }]
  );
}
