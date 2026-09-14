import { sanitizeUrl } from '@/lib/email-components';
import { INCIDENT_PRIORITIES, getIncidentPriorityDefinition } from '@/lib/incidents/priority';
import { TEAMS_CHATOPS_VERBS } from './action-schema';

/** JSON-safe URL for Adaptive Card Action.OpenUrl (host does no HTML unescape). */
function safeTeamsUrl(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  // Only allow http(s) in channel cards; sanitizeUrl guards the same prefix but
  // returns an HTML-escaped string (&amp;). For JSON we need the raw safe URL.
  if (!/^(https?:\/\/)/i.test(trimmed)) return '#';
  // sanitizeUrl also normalises &amp; → & then escapes; a passing check means
  // the scheme is allowed — return the trimmed raw value (already validated).
  const checked = sanitizeUrl(trimmed);
  return checked === '#' ? '#' : trimmed;
}

export type MicrosoftTeamsIncidentCardInput = {
  incident: {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    urgency: string;
    priority?: string | null;
    serviceName: string;
    assigneeName?: string | null;
    incidentUrl: string;
    acknowledgedBy?: string | null;
    resolvedBy?: string | null;
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
    slaAckRemainingMs?: number | null;
    slaResolveRemainingMs?: number | null;
  };
  eventType: 'triggered' | 'acknowledged' | 'resolved';
};

export type MicrosoftTeamsCardOptions = {
  /** When true, render card with actions disabled (e.g. resolved terminal state). */
  disableActions?: boolean;
  interactive?: {
    destinationId: string;
    messageGeneration: number;
    /** A war-room card has a separate activity reference from destination cards. */
    warRoomId?: string;
    refreshUserIds?: string[];
    capabilities?: Partial<{
      canAcknowledge: boolean; canResolve: boolean; canAssignSelf: boolean;
      canAddNote: boolean; canSetPriority: boolean; canSnooze: boolean;
      canEscalate: boolean; canJoinResponder: boolean; canRead: boolean;
    }>;
  };
};

export type TeamsIncidentPresentationState = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED' | 'SUPPRESSED';

export function deriveTeamsIncidentPresentation(input: MicrosoftTeamsIncidentCardInput): TeamsIncidentPresentationState {
  if (input.incident.status === 'RESOLVED') return 'RESOLVED';
  if (input.incident.status === 'SNOOZED') return 'SNOOZED';
  if (input.incident.status === 'SUPPRESSED') return 'SUPPRESSED';
  if (input.incident.status === 'ACKNOWLEDGED' || input.eventType === 'acknowledged') return 'ACKNOWLEDGED';
  return 'OPEN';
}

function interactiveActions(input: MicrosoftTeamsIncidentCardInput, options?: MicrosoftTeamsCardOptions): Array<Record<string, unknown>> {
  const interactive = options?.interactive;
  if (!interactive || options?.disableActions) return [];
  const caps = interactive.capabilities;
  const allow = (key: keyof NonNullable<typeof caps>) => {
    if (!caps) return true;
    switch (key) {
      case 'canAcknowledge': return caps.canAcknowledge === true;
      case 'canResolve': return caps.canResolve === true;
      case 'canAssignSelf': return caps.canAssignSelf === true;
      case 'canAddNote': return caps.canAddNote === true;
      case 'canSetPriority': return caps.canSetPriority === true;
      case 'canSnooze': return caps.canSnooze === true;
      case 'canEscalate': return caps.canEscalate === true;
      case 'canJoinResponder': return caps.canJoinResponder === true;
      case 'canRead': return caps.canRead === true;
    }
  };
  const ctx = { v: 2, incidentId: input.incident.id, destinationId: interactive.destinationId, messageGeneration: interactive.messageGeneration, ...(interactive.warRoomId ? { warRoomId: interactive.warRoomId } : {}) };
  const execute = (title: string, verb: string, mode?: 'secondary') => ({ type: 'Action.Execute', title, verb, associatedInputs: 'none', data: ctx, ...(mode ? { mode } : {}) });
  const actions: Array<Record<string, unknown>> = [];
  if (!input.incident.acknowledgedAt && allow('canAcknowledge')) actions.push(execute('Acknowledge', TEAMS_CHATOPS_VERBS.ACK));
  if (input.incident.acknowledgedAt && input.incident.status !== 'RESOLVED' && allow('canResolve')) actions.push(execute('Resolve', TEAMS_CHATOPS_VERBS.RESOLVE));
  if (allow('canAssignSelf')) actions.push(execute('Assign to me', TEAMS_CHATOPS_VERBS.ASSIGN_SELF));
  if (allow('canEscalate')) actions.push(execute('Escalate', TEAMS_CHATOPS_VERBS.ESCALATE));
  if (allow('canAddNote')) actions.push({ type: 'Action.ShowCard', title: 'Add note', mode: 'secondary', card: { type: 'AdaptiveCard', version: '1.5', body: [{ type: 'Input.Text', id: 'note', label: 'Incident note', isMultiline: true, isRequired: true, maxLength: 2000, errorMessage: 'Enter a note.' }], actions: [{ type: 'Action.Execute', title: 'Add note', verb: TEAMS_CHATOPS_VERBS.NOTE, associatedInputs: 'auto', data: ctx }] } });
  if (allow('canSetPriority')) actions.push({ type: 'Action.ShowCard', title: 'Priority', mode: 'secondary', card: { type: 'AdaptiveCard', version: '1.5', body: [{ type: 'Input.ChoiceSet', id: 'priority', label: 'Priority', value: input.incident.priority ?? 'P3', choices: INCIDENT_PRIORITIES.map(priority => ({ title: `${priority} — ${getIncidentPriorityDefinition(priority).label}`, value: priority })) }], actions: [{ type: 'Action.Execute', title: 'Set priority', verb: TEAMS_CHATOPS_VERBS.PRIORITY, associatedInputs: 'auto', data: ctx }] } });
  if (allow('canSnooze')) actions.push({ type: 'Action.ShowCard', title: 'Snooze', mode: 'secondary', card: { type: 'AdaptiveCard', version: '1.5', body: [{ type: 'Input.ChoiceSet', id: 'minutes', label: 'Duration', value: '30', choices: [{ title: '15 minutes', value: '15' }, { title: '30 minutes', value: '30' }, { title: '1 hour', value: '60' }, { title: '2 hours', value: '120' }] }, { type: 'Input.Text', id: 'reason', label: 'Reason (optional)', maxLength: 500 }], actions: [{ type: 'Action.Execute', title: 'Snooze', verb: TEAMS_CHATOPS_VERBS.SNOOZE, associatedInputs: 'auto', data: ctx }] } });
  if (allow('canJoinResponder')) actions.push(execute('Join as responder', TEAMS_CHATOPS_VERBS.JOIN_RESPONDER, 'secondary'));
  if (allow('canRead')) actions.push(execute('Current responders', TEAMS_CHATOPS_VERBS.WHO, 'secondary'));
  return actions;
}

/** Brand-aligned accent color for the Adaptive Card header. */
function statusAccent(eventType: MicrosoftTeamsIncidentCardInput['eventType']): string {
  if (eventType === 'resolved') return '#059669';
  if (eventType === 'acknowledged') return '#d97706';
  return '#e11d48';
}

function statusBadge(eventType: MicrosoftTeamsIncidentCardInput['eventType']): string {
  if (eventType === 'resolved') return 'Resolved';
  if (eventType === 'acknowledged') return 'Acknowledged';
  return 'Triggered';
}

function safeIncidentDescription(value: string | null | undefined, maxLen = 280): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}

/**
 * Phase 1 Adaptive Card.
 *
 * Phase 1 is one-way only: it must render Triggered → Acknowledged → Resolved
 * and expose only "View Incident". Action.Execute buttons for Ack/Resolve/
 * Assign are intentionally absent in Phase 1 but the invoke handler is ready
 * for Phase 2 (`adaptiveCard/action`).
 *
 * Phase 1 canonical lifecycle: create (no prior message) → update (existing
 * messageId) → disableActions (terminal) → recover (404 → create new).
 * `disableActions` is the Phase-2 seam: Phase-1 has only View Incident, but
 * when `disableActions` is true the card renders a terminal footer and omits
 * interactive chrome so a future Phase-2 Action.Execute set can be disabled
 * without a second code path.
 */
export function buildMicrosoftTeamsIncidentCard(
  input: MicrosoftTeamsIncidentCardInput,
  options?: MicrosoftTeamsCardOptions,
) {
  const { incident, eventType } = input;
  const presentation = deriveTeamsIncidentPresentation(input);
  const safeUrl = safeTeamsUrl(incident.incidentUrl);

  const description = safeIncidentDescription(incident.description);
  const subtitle = `${incident.serviceName} · ${incident.urgency}${incident.priority ? ` · ${incident.priority}` : ''}`;

  const facts: Array<{ title: string; value: string }> = [
    { title: 'Status', value: incident.status },
    { title: 'Service', value: incident.serviceName },
    { title: 'Urgency', value: incident.urgency },
  ];
  if (incident.assigneeName) facts.push({ title: 'Assignee', value: incident.assigneeName });
  if (incident.priority) facts.push({ title: 'Priority', value: incident.priority });

  const disableActions = Boolean(options?.disableActions);
  const chatOpsActions = interactiveActions(input, options);
  function slaLabel(remainingMs: number | null | undefined): string | null {
    if (remainingMs == null || !Number.isFinite(remainingMs)) return null;
    if (remainingMs <= 0) return 'SLA breached';
    const mins = Math.ceil(remainingMs / 60_000);
    if (mins < 60) return `SLA ${mins}m remaining`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `SLA ${hrs}h ${rem}m remaining` : `SLA ${hrs}h remaining`;
  }
  const slaRemaining = eventType === 'acknowledged' ? null : eventType === 'resolved' ? incident.slaResolveRemainingMs : incident.slaAckRemainingMs;
  const slaText = slaLabel(slaRemaining ?? null);
  const disableActionsFoot = disableActions && eventType === 'resolved' ? `Resolved — actions disabled` : null;
  const actorFoot =
    eventType === 'acknowledged' && incident.acknowledgedBy
      ? `Acknowledged by ${incident.acknowledgedBy}`
      : eventType === 'resolved' && incident.resolvedBy
        ? `Resolved by ${incident.resolvedBy}`
        : null;
  const timeFoot = `Created ${incident.createdAt.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
  const footParts = [disableActionsFoot ?? actorFoot ?? timeFoot, slaText].filter(Boolean) as string[];
  const foot = footParts.join(' · ');

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        bleed: true,
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  { type: 'TextBlock', text: `OpsKnight · ${presentation === 'OPEN' ? statusBadge(eventType) : presentation[0] + presentation.slice(1).toLowerCase()}`, weight: 'Bolder', size: 'Medium', color: 'Attention', wrap: true },
                  { type: 'TextBlock', text: incident.title, weight: 'Bolder', size: 'Large', wrap: true, maxLines: 2 },
                  { type: 'TextBlock', text: subtitle, isSubtle: true, size: 'Small', wrap: true, spacing: 'Small' },
                ],
              },
              {
                type: 'Column',
                width: 'auto',
                items: [
                  {
                    type: 'TextBlock',
                    text: statusBadge(eventType),
                    size: 'Small',
                    weight: 'Bolder',
                    color: eventType === 'resolved' ? 'Good' : eventType === 'acknowledged' ? 'Warning' : 'Attention',
                    wrap: true,
                  },
                ],
              },
            ],
          },
          // Accent border hint — adaptive hosts ignore unknown props, so this degrades safely.
          { type: 'TextBlock', text: ' ', spacing: 'None' },
        ],
        // Hosts that support `bleed` will show the emphasis background as the header.
        // Keep an explicit separator before body content for readability.
      },
      {
        type: 'Container',
        items: [
          { type: 'FactSet', facts },
          ...(description
            ? [{ type: 'TextBlock', text: description, wrap: true, spacing: 'Medium', isSubtle: true } as const]
            : []),
          { type: 'TextBlock', text: foot, isSubtle: true, size: 'Small', wrap: true, spacing: 'Medium' },
        ],
      },
    ],
    actions: [...chatOpsActions, { type: 'Action.OpenUrl', title: 'View Incident ↗', url: safeUrl, ...(options?.interactive ? { mode: 'secondary' } : {}) }],
    ...(options?.interactive ? { refresh: { action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.REFRESH, data: { v: 2, incidentId: incident.id, destinationId: options.interactive.destinationId, messageGeneration: options.interactive.messageGeneration, ...(options.interactive.warRoomId ? { warRoomId: options.interactive.warRoomId } : {}) } }, ...(options.interactive.refreshUserIds?.length ? { userIds: options.interactive.refreshUserIds.slice(0, 60) } : {}) } } : {}),
    // Phase 2 note: ACK/Resolve/Assign will use Action.Execute with verb `opsknight.ack` etc.
    // and route through POST /api/microsoft-teams/messages as `invoke` activity.
    // Intentionally omitted in Phase 1 per spec — prepare the architecture, not the buttons.
    // Accent color is carried by the header emphasis; Adaptive Cards have no standard `accentColor` prop,
    // so do not rely on it for accessibility — the status badge text is the semantic signal.
    _opsknightMeta: { accent: statusAccent(eventType), eventType },
  };
}
