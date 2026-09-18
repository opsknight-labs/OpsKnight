import { sanitizeUrl } from '@/lib/email-components';
import { INCIDENT_PRIORITIES, getIncidentPriorityDefinition } from '@/lib/incidents/priority';
import { CHATOPS_ACTIONS, type ChatOpsActionKind } from '@/lib/chatops/action-contract';
import { TEAMS_CHATOPS_VERBS } from './action-schema';
import { teamsVerbForChatOpsKind } from '@/lib/chatops/teams-action-map';

/** JSON-safe URL for Adaptive Card Action.OpenUrl (host does no HTML unescape). */
function safeTeamsUrl(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (!/^(https?:\/\/)/i.test(trimmed)) return '#';
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
  meeting?: {
    provider: string;
    joinUrl: string;
    joinWebUrl?: string | null;
    conferenceId?: string | null;
    tollNumber?: string | null;
  } | null;
  interactive?: {
    destinationId: string;
    messageGeneration: number;
    /** A war-room card has a separate activity reference from destination cards. */
    warRoomId?: string;
    refreshUserIds?: string[];
    capabilities?: Partial<{
      canAcknowledge: boolean;
      canResolve: boolean;
      canAssignSelf: boolean;
      canAddNote: boolean;
      canSetPriority: boolean;
      canSnooze: boolean;
      canEscalate: boolean;
      canJoinResponder: boolean;
      canRead: boolean;
    }>;
  };
};

export type TeamsIncidentPresentationState =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'SNOOZED'
  | 'RESOLVED'
  | 'SUPPRESSED';

export function deriveTeamsIncidentPresentation(
  input: MicrosoftTeamsIncidentCardInput
): TeamsIncidentPresentationState {
  if (input.incident.status === 'RESOLVED') return 'RESOLVED';
  if (input.incident.status === 'SNOOZED') return 'SNOOZED';
  if (input.incident.status === 'SUPPRESSED') return 'SUPPRESSED';
  if (input.incident.status === 'ACKNOWLEDGED' || input.eventType === 'acknowledged')
    return 'ACKNOWLEDGED';
  return 'OPEN';
}

function warRoomPhaseForInput(
  input: MicrosoftTeamsIncidentCardInput
): 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED' {
  if (input.incident.status === 'RESOLVED') return 'RESOLVED';
  if (
    input.incident.acknowledgedAt ||
    input.incident.status === 'ACKNOWLEDGED' ||
    input.eventType === 'acknowledged'
  )
    return 'ACKNOWLEDGED';
  return 'TRIGGERED';
}

function interactiveActions(
  input: MicrosoftTeamsIncidentCardInput,
  options?: MicrosoftTeamsCardOptions
): Array<Record<string, unknown>> {
  const interactive = options?.interactive;
  if (!interactive || options?.disableActions) return [];
  const caps = interactive.capabilities;
  // P1-2: shared channel card must fail-closed. No caps → no privileged controls, only View Incident + refresh.
  // P1-8: phase comes from central contract, not ad-hoc acknowledgedAt checks.
  const phase = warRoomPhaseForInput(input);
  if (phase === 'RESOLVED') return [];

  const allow = (key: keyof NonNullable<typeof caps>): boolean => {
    if (!caps) return false;
    switch (key) {
      case 'canAcknowledge':
        return caps.canAcknowledge === true;
      case 'canResolve':
        return caps.canResolve === true;
      case 'canAssignSelf':
        return caps.canAssignSelf === true;
      case 'canAddNote':
        return caps.canAddNote === true;
      case 'canSetPriority':
        return caps.canSetPriority === true;
      case 'canSnooze':
        return caps.canSnooze === true;
      case 'canEscalate':
        return caps.canEscalate === true;
      case 'canJoinResponder':
        return caps.canJoinResponder === true;
      case 'canRead':
        return caps.canRead === true;
    }
  };
  const isAllowedInPhase = (kind: ChatOpsActionKind): boolean => {
    switch (kind) {
      case 'ACKNOWLEDGE':
        return (CHATOPS_ACTIONS.ACKNOWLEDGE.phases as readonly string[]).includes(phase);
      case 'RESOLVE':
        return (CHATOPS_ACTIONS.RESOLVE.phases as readonly string[]).includes(phase);
      case 'ASSIGN_SELF':
        return (CHATOPS_ACTIONS.ASSIGN_SELF.phases as readonly string[]).includes(phase);
      case 'ESCALATE':
        return (CHATOPS_ACTIONS.ESCALATE.phases as readonly string[]).includes(phase);
      case 'ADD_NOTE':
        return (CHATOPS_ACTIONS.ADD_NOTE.phases as readonly string[]).includes(phase);
      case 'SET_PRIORITY':
        return (CHATOPS_ACTIONS.SET_PRIORITY.phases as readonly string[]).includes(phase);
      case 'SNOOZE':
        return (CHATOPS_ACTIONS.SNOOZE.phases as readonly string[]).includes(phase);
      case 'JOIN_RESPONDER':
        return (CHATOPS_ACTIONS.JOIN_RESPONDER.phases as readonly string[]).includes(phase);
      case 'VIEW_RESPONDERS':
      case 'REFRESH':
        return true;
      default:
        return false;
    }
  };
  const ctx = {
    v: 2,
    incidentId: input.incident.id,
    destinationId: interactive.destinationId,
    messageGeneration: interactive.messageGeneration,
    ...(interactive.warRoomId ? { warRoomId: interactive.warRoomId } : {}),
  };
  const execute = (title: string, verb: string, mode?: 'secondary') => ({
    type: 'Action.Execute',
    title,
    verb,
    associatedInputs: 'none',
    data: ctx,
    ...(mode ? { mode } : {}),
  });
  const actions: Array<Record<string, unknown>> = [];

  // Order follows CHATOPS_ACTIONS registry; phase+capability gates are the single source of truth.
  if (isAllowedInPhase('ACKNOWLEDGE') && allow('canAcknowledge'))
    actions.push(
      execute(CHATOPS_ACTIONS.ACKNOWLEDGE.title, teamsVerbForChatOpsKind('ACKNOWLEDGE'))
    );
  if (isAllowedInPhase('RESOLVE') && allow('canResolve')) {
    // P1-9: Resolve as ShowCard with optional resolutionNote textarea mirroring domain 10-1000 char bounds.
    actions.push({
      type: 'Action.ShowCard',
      title: CHATOPS_ACTIONS.RESOLVE.title,
      card: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          {
            type: 'Input.Text',
            id: 'resolutionNote',
            label: 'Resolution note (optional)',
            placeholder: '10–1000 characters if provided',
            isMultiline: true,
            isRequired: false,
            maxLength: 1000,
          },
        ],
        actions: [
          {
            type: 'Action.Execute',
            title: 'Resolve incident',
            verb: teamsVerbForChatOpsKind('RESOLVE'),
            associatedInputs: 'auto',
            data: ctx,
          },
        ],
      },
    });
  }
  if (isAllowedInPhase('ASSIGN_SELF') && allow('canAssignSelf'))
    actions.push(
      execute(CHATOPS_ACTIONS.ASSIGN_SELF.title, teamsVerbForChatOpsKind('ASSIGN_SELF'))
    );
  if (isAllowedInPhase('ESCALATE') && allow('canEscalate'))
    actions.push(execute(CHATOPS_ACTIONS.ESCALATE.title, teamsVerbForChatOpsKind('ESCALATE')));
  if (isAllowedInPhase('ADD_NOTE') && allow('canAddNote'))
    actions.push({
      type: 'Action.ShowCard',
      title: CHATOPS_ACTIONS.ADD_NOTE.title,
      mode: 'secondary',
      card: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          {
            type: 'Input.Text',
            id: 'note',
            label: 'Incident note',
            isMultiline: true,
            isRequired: true,
            maxLength: 2000,
            errorMessage: 'Enter a note.',
          },
        ],
        actions: [
          {
            type: 'Action.Execute',
            title: 'Add note',
            verb: teamsVerbForChatOpsKind('ADD_NOTE'),
            associatedInputs: 'auto',
            data: ctx,
          },
        ],
      },
    });
  if (isAllowedInPhase('SET_PRIORITY') && allow('canSetPriority'))
    actions.push({
      type: 'Action.ShowCard',
      title: CHATOPS_ACTIONS.SET_PRIORITY.title,
      mode: 'secondary',
      card: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          {
            type: 'Input.ChoiceSet',
            id: 'priority',
            label: 'Priority',
            value: input.incident.priority ?? 'P3',
            choices: INCIDENT_PRIORITIES.map(priority => ({
              title: `${priority} — ${getIncidentPriorityDefinition(priority).label}`,
              value: priority,
            })),
          },
        ],
        actions: [
          {
            type: 'Action.Execute',
            title: 'Set priority',
            verb: teamsVerbForChatOpsKind('SET_PRIORITY'),
            associatedInputs: 'auto',
            data: ctx,
          },
        ],
      },
    });
  if (isAllowedInPhase('SNOOZE') && allow('canSnooze'))
    actions.push({
      type: 'Action.ShowCard',
      title: CHATOPS_ACTIONS.SNOOZE.title,
      mode: 'secondary',
      card: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          {
            type: 'Input.ChoiceSet',
            id: 'minutes',
            label: 'Duration',
            value: '30',
            choices: [
              { title: '15 minutes', value: '15' },
              { title: '30 minutes', value: '30' },
              { title: '1 hour', value: '60' },
              { title: '2 hours', value: '120' },
            ],
          },
          { type: 'Input.Text', id: 'reason', label: 'Reason (optional)', maxLength: 500 },
        ],
        actions: [
          {
            type: 'Action.Execute',
            title: 'Snooze',
            verb: teamsVerbForChatOpsKind('SNOOZE'),
            associatedInputs: 'auto',
            data: ctx,
          },
        ],
      },
    });
  if (isAllowedInPhase('JOIN_RESPONDER') && allow('canJoinResponder'))
    actions.push(
      execute(
        CHATOPS_ACTIONS.JOIN_RESPONDER.title,
        teamsVerbForChatOpsKind('JOIN_RESPONDER'),
        'secondary'
      )
    );
  if (isAllowedInPhase('VIEW_RESPONDERS') && allow('canRead'))
    actions.push(
      execute(
        CHATOPS_ACTIONS.VIEW_RESPONDERS.title,
        teamsVerbForChatOpsKind('VIEW_RESPONDERS'),
        'secondary'
      )
    );
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

function formatTeamsMeetingLabel(provider?: string | null): string {
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

/**
 * War-room incident card — capability-aware.
 *
 * Shared channel card (no capabilities): fail-closed → only incident info + View Incident + refresh.
 * Personalized refresh (with capabilities): capability-filtered controls per central CHATOPS_ACTIONS registry.
 */
export function buildMicrosoftTeamsIncidentCard(
  input: MicrosoftTeamsIncidentCardInput,
  options?: MicrosoftTeamsCardOptions
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
  const slaRemaining =
    eventType === 'acknowledged'
      ? null
      : eventType === 'resolved'
        ? incident.slaResolveRemainingMs
        : incident.slaAckRemainingMs;
  const slaText = slaLabel(slaRemaining ?? null);
  const disableActionsFoot =
    disableActions && eventType === 'resolved' ? `Resolved — actions disabled` : null;
  const actorFoot =
    eventType === 'acknowledged' && incident.acknowledgedBy
      ? `Acknowledged by ${incident.acknowledgedBy}`
      : eventType === 'resolved' && incident.resolvedBy
        ? `Resolved by ${incident.resolvedBy}`
        : null;
  const timeFoot = `Created ${incident.createdAt.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
  const footParts = [disableActionsFoot ?? actorFoot ?? timeFoot, slaText].filter(
    Boolean
  ) as string[];
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
                  {
                    type: 'TextBlock',
                    text: `OpsKnight · ${presentation === 'OPEN' ? statusBadge(eventType) : presentation[0] + presentation.slice(1).toLowerCase()}`,
                    weight: 'Bolder',
                    size: 'Medium',
                    color: 'Attention',
                    wrap: true,
                  },
                  {
                    type: 'TextBlock',
                    text: incident.title,
                    weight: 'Bolder',
                    size: 'Large',
                    wrap: true,
                    maxLines: 2,
                  },
                  {
                    type: 'TextBlock',
                    text: subtitle,
                    isSubtle: true,
                    size: 'Small',
                    wrap: true,
                    spacing: 'Small',
                  },
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
                    color:
                      eventType === 'resolved'
                        ? 'Good'
                        : eventType === 'acknowledged'
                          ? 'Warning'
                          : 'Attention',
                    wrap: true,
                  },
                ],
              },
            ],
          },
          { type: 'TextBlock', text: ' ', spacing: 'None' },
        ],
      },
      {
        type: 'Container',
        items: [
          { type: 'FactSet', facts },
          ...(description
            ? [
                {
                  type: 'TextBlock',
                  text: description,
                  wrap: true,
                  spacing: 'Medium',
                  isSubtle: true,
                } as const,
              ]
            : []),
          ...(options?.meeting?.joinUrl && !disableActions
            ? [
                {
                  type: 'Container',
                  style: 'accent',
                  spacing: 'Medium',
                  items: [
                    {
                      type: 'TextBlock',
                      text: `📹 **Video Bridge**: [Join ${formatTeamsMeetingLabel(options.meeting.provider)} Meeting](${safeTeamsUrl(options.meeting.joinUrl)})`,
                      wrap: true,
                    },
                  ],
                } as const,
              ]
            : []),
          {
            type: 'TextBlock',
            text: foot,
            isSubtle: true,
            size: 'Small',
            wrap: true,
            spacing: 'Medium',
          },
          {
            type: 'TextBlock',
            text: '[OpsKnight](https://opsknight.com) — Open-source incident response & on-call platform',
            isSubtle: true,
            size: 'Small',
            wrap: true,
            spacing: 'Small',
          },
        ],
      },
    ],
    actions: [
      ...chatOpsActions,
      ...(options?.meeting?.joinUrl && !disableActions
        ? [
            {
              type: 'Action.OpenUrl' as const,
              title: `Join ${formatTeamsMeetingLabel(options.meeting.provider)} Meeting`,
              url: safeTeamsUrl(options.meeting.joinUrl),
              style: 'positive' as const,
            },
          ]
        : []),
      {
        type: 'Action.OpenUrl',
        title: 'View Incident ↗',
        url: safeUrl,
        ...(options?.interactive ? { mode: 'secondary' } : {}),
      },
    ],
    ...(options?.interactive
      ? {
          refresh: {
            action: {
              type: 'Action.Execute',
              verb: TEAMS_CHATOPS_VERBS.REFRESH,
              data: {
                v: 2,
                incidentId: incident.id,
                destinationId: options.interactive.destinationId,
                messageGeneration: options.interactive.messageGeneration,
                ...(options.interactive.warRoomId
                  ? { warRoomId: options.interactive.warRoomId }
                  : {}),
              },
            },
            ...(options.interactive.refreshUserIds?.length
              ? { userIds: options.interactive.refreshUserIds.slice(0, 60) }
              : {}),
          },
        }
      : {}),
    _opsknightMeta: { accent: statusAccent(eventType), eventType },
  };
}
