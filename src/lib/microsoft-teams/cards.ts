import { sanitizeUrl } from '@/lib/html-sanitize';
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
    /** Role holders in catalog order (see `summarizeIncidentRoles`). */
    roles?: Array<{ shortLabel: string; name: string }>;
    incidentUrl: string;
    acknowledgedBy?: string | null;
    resolvedBy?: string | null;
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
    slaAckRemainingMs?: number | null;
    slaResolveRemainingMs?: number | null;
    snoozedUntil?: Date | null;
    /** Current escalation level (1-based) and who it is paging, when the policy has moved past level 1. */
    escalation?: { level: number; target?: string | null } | null;
    /** Set when this card replaces a create whose outcome Teams never confirmed. */
    repostNotice?: boolean;
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
      canTakeCommand: boolean;
      canRead: boolean;
    }>;
  };
};

export type TeamsIncidentPresentationState =
  'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED' | 'SUPPRESSED';

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

const RESOLUTION_NOTE_MAX = 1000;
export const RESOLUTION_NOTE_REGEX = '^(?:\\s*|\\s*\\S[\\s\\S]{8,998}\\S\\s*)$';

function interactiveActions(
  input: MicrosoftTeamsIncidentCardInput,
  options?: MicrosoftTeamsCardOptions
): Array<Record<string, unknown>> {
  const interactive = options?.interactive;
  if (!interactive || options?.disableActions) return [];
  const caps = interactive.capabilities;
  // Shared channel card (no caps): only Acknowledge / Resolve (invoke re-checks identity + RBAC) + View + refresh.
  // P1-8: phase comes from central contract, not ad-hoc acknowledgedAt checks.
  const phase = warRoomPhaseForInput(input);
  if (phase === 'RESOLVED') return [];

  const allow = (key: keyof NonNullable<typeof caps>): boolean => {
    // Shared (not personalised) card: Acknowledge and Resolve are safe to show to everyone because
    // the invoke handler re-checks the clicker's identity and RBAC; everything else waits for refresh.
    if (!caps) return key === 'canAcknowledge' || key === 'canResolve';
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
      case 'canTakeCommand':
        return caps.canTakeCommand === true;
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
      case 'TAKE_COMMAND':
        return (CHATOPS_ACTIONS.TAKE_COMMAND.phases as readonly string[]).includes(phase);
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
            maxLength: RESOLUTION_NOTE_MAX,
            // Same rule as the server (action-schema + lifecycle): blank, or 10–1000 characters once trimmed.
            regex: RESOLUTION_NOTE_REGEX,
            errorMessage: 'Leave it empty or write 10 to 1000 characters.',
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
  if (isAllowedInPhase('TAKE_COMMAND') && allow('canTakeCommand'))
    actions.push(
      execute(
        CHATOPS_ACTIONS.TAKE_COMMAND.title,
        teamsVerbForChatOpsKind('TAKE_COMMAND'),
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

type CardVisual = {
  key: 'TRIGGERED' | 'ESCALATED' | 'ACKNOWLEDGED' | 'SNOOZED' | 'SUPPRESSED' | 'RESOLVED';
  label: string;
  /** Adaptive Card container style for the header band. */
  style: 'attention' | 'warning' | 'good' | 'emphasis';
  /** Adaptive Card text colour for the single status badge. */
  color: 'Attention' | 'Warning' | 'Good' | 'Default';
};

/** One visual state per card: the header band and the badge always agree. */
export function teamsIncidentCardVisual(input: MicrosoftTeamsIncidentCardInput): CardVisual {
  const { incident, eventType } = input;
  if (eventType === 'resolved' || incident.status === 'RESOLVED')
    return { key: 'RESOLVED', label: 'Resolved', style: 'good', color: 'Good' };
  if (incident.status === 'SNOOZED')
    return { key: 'SNOOZED', label: 'Snoozed', style: 'warning', color: 'Warning' };
  if (incident.status === 'SUPPRESSED')
    return { key: 'SUPPRESSED', label: 'Suppressed', style: 'emphasis', color: 'Default' };
  if (eventType === 'acknowledged' || incident.status === 'ACKNOWLEDGED')
    return { key: 'ACKNOWLEDGED', label: 'Acknowledged', style: 'warning', color: 'Warning' };
  if ((incident.escalation?.level ?? 1) > 1)
    return { key: 'ESCALATED', label: 'Escalated', style: 'attention', color: 'Attention' };
  return { key: 'TRIGGERED', label: 'Triggered', style: 'attention', color: 'Attention' };
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

const URGENCY_LABELS: Record<string, string> = {
  HIGH: 'High urgency',
  MEDIUM: 'Medium urgency',
  LOW: 'Low urgency',
};

/** "P1 · Crisis" for a known priority; unknown values pass through unchanged. */
export function teamsPriorityLabel(priority: string | null | undefined): string | null {
  if (!priority) return null;
  return (INCIDENT_PRIORITIES as readonly string[]).includes(priority)
    ? `${priority} · ${getIncidentPriorityDefinition(priority as (typeof INCIDENT_PRIORITIES)[number]).label}`
    : priority;
}

export function teamsUrgencyLabel(urgency: string | null | undefined): string | null {
  if (!urgency) return null;
  // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
  return URGENCY_LABELS[urgency] ?? urgency.charAt(0) + urgency.slice(1).toLowerCase();
}

/** Adaptive Card DATE/TIME functions need RFC 3339 without fractional seconds. */
function cardInstant(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Rendered in the reader's own locale and time zone by Teams. */
function localTime(date: Date | null | undefined): string | null {
  const iso = cardInstant(date);
  return iso ? `{{DATE(${iso}, SHORT)}} {{TIME(${iso})}}` : null;
}

/**
 * Activity `summary` / card `fallbackText`: what Teams shows in the activity feed and push
 * notifications. Plain text, never markdown.
 */
export function teamsIncidentActivitySummary(input: MicrosoftTeamsIncidentCardInput): string {
  const visual = teamsIncidentCardVisual(input);
  const prefix = input.incident.priority ? `[${input.incident.priority}] ` : '';
  const title = safeIncidentDescription(input.incident.title, 120) ?? 'Incident';
  return `${prefix}${visual.label}: ${title}`;
}

/** Plain-text line (TextRuns are never parsed as markdown, so alert text cannot inject links). */
function plainLine(
  text: string,
  run: Record<string, unknown> = {},
  block: Record<string, unknown> = {}
): Record<string, unknown> {
  return { type: 'RichTextBlock', inlines: [{ type: 'TextRun', text, ...run }], ...block };
}

function slaLabel(remainingMs: number | null | undefined): string | null {
  if (remainingMs == null || !Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return 'SLA breached';
  const mins = Math.ceil(remainingMs / 60_000);
  if (mins < 60) return `SLA ${mins}m remaining`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `SLA ${hrs}h ${rem}m remaining` : `SLA ${hrs}h remaining`;
}

/**
 * Incident card for channel notifications and war rooms.
 *
 * Shared card (interactive, no capabilities): Acknowledge / Resolve (the invoke re-checks identity
 * and RBAC) + View incident + a per-user refresh that adds the rest of the clicker's actions.
 * Personalised refresh (with capabilities): capability-filtered controls per CHATOPS_ACTIONS.
 */
export function buildMicrosoftTeamsIncidentCard(
  input: MicrosoftTeamsIncidentCardInput,
  options?: MicrosoftTeamsCardOptions
) {
  const { incident, eventType } = input;
  const visual = teamsIncidentCardVisual(input);
  const safeUrl = safeTeamsUrl(incident.incidentUrl);
  const disableActions = Boolean(options?.disableActions);
  const chatOpsActions = interactiveActions(input, options);
  const summary = teamsIncidentActivitySummary(input);

  const title = safeIncidentDescription(incident.title, 200) ?? '';
  const factsLine = [
    incident.serviceName ? `Service: ${incident.serviceName}` : null,
    teamsUrgencyLabel(incident.urgency),
    teamsPriorityLabel(incident.priority),
  ]
    .filter(Boolean)
    .join(' · ');
  const description = safeIncidentDescription(incident.description);

  const people: Array<Record<string, unknown>> = [];
  if (incident.assigneeName)
    people.push(plainLine(`Assignee: ${incident.assigneeName}`, {}, { spacing: 'Small' }));
  for (const role of incident.roles ?? [])
    people.push(plainLine(`${role.shortLabel}: ${role.name}`, {}, { spacing: 'Small' }));

  const actorLine =
    visual.key === 'ACKNOWLEDGED' && incident.acknowledgedBy
      ? `Acknowledged by ${incident.acknowledgedBy}`
      : visual.key === 'RESOLVED' && incident.resolvedBy
        ? `Resolved by ${incident.resolvedBy}`
        : null;

  const escalationLine =
    visual.key === 'ESCALATED' && incident.escalation
      ? `Escalated to level ${incident.escalation.level}${
          incident.escalation.target ? ` · paging ${incident.escalation.target}` : ''
        }`
      : null;

  const slaRemaining =
    visual.key === 'RESOLVED'
      ? null
      : visual.key === 'ACKNOWLEDGED'
        ? incident.slaResolveRemainingMs
        : incident.slaAckRemainingMs;
  const timeParts = [
    visual.key === 'RESOLVED' && localTime(incident.resolvedAt)
      ? `Resolved ${localTime(incident.resolvedAt)}`
      : visual.key === 'ACKNOWLEDGED' && localTime(incident.acknowledgedAt)
        ? `Acknowledged ${localTime(incident.acknowledgedAt)}`
        : null,
    visual.key === 'SNOOZED' && localTime(incident.snoozedUntil)
      ? `Snoozed until ${localTime(incident.snoozedUntil)}`
      : null,
    localTime(incident.createdAt) ? `Started ${localTime(incident.createdAt)}` : null,
    slaLabel(slaRemaining ?? null),
  ].filter(Boolean) as string[];

  const meetingUrl =
    options?.meeting?.joinUrl && !disableActions ? safeTeamsUrl(options.meeting.joinUrl) : null;

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    fallbackText: summary,
    body: [
      {
        type: 'Container',
        style: visual.style,
        bleed: true,
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  plainLine(`${incident.priority ? `[${incident.priority}] ` : ''}${title}`, {
                    weight: 'Bolder',
                    size: 'Large',
                  }),
                  ...(factsLine
                    ? [
                        plainLine(
                          factsLine,
                          { isSubtle: true, size: 'Small' },
                          { spacing: 'Small' }
                        ),
                      ]
                    : []),
                ],
              },
              {
                type: 'Column',
                width: 'auto',
                verticalContentAlignment: 'Top',
                items: [
                  {
                    type: 'TextBlock',
                    text: visual.label,
                    size: 'Small',
                    weight: 'Bolder',
                    color: visual.color,
                    wrap: false,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'Container',
        items: [
          ...(escalationLine
            ? [plainLine(escalationLine, { weight: 'Bolder', color: 'Attention' })]
            : []),
          ...(actorLine ? [plainLine(actorLine, { weight: 'Bolder', color: visual.color })] : []),
          ...(description
            ? [
                plainLine(
                  description,
                  {},
                  { spacing: actorLine || escalationLine ? 'Small' : 'None' }
                ),
              ]
            : []),
          ...people,
          ...(incident.repostNotice
            ? [
                {
                  type: 'TextBlock',
                  text: 'Re-posted after Teams did not confirm delivery. An earlier copy of this card may exist.',
                  isSubtle: true,
                  size: 'Small',
                  color: 'Warning',
                  wrap: true,
                  spacing: 'Medium',
                },
              ]
            : []),
          ...(timeParts.length
            ? [
                {
                  type: 'TextBlock',
                  text: timeParts.join(' · '),
                  isSubtle: true,
                  size: 'Small',
                  wrap: true,
                  spacing: 'Medium',
                },
              ]
            : []),
        ],
      },
    ],
    actions: [
      ...chatOpsActions,
      ...(meetingUrl
        ? [
            {
              type: 'Action.OpenUrl' as const,
              title: `Join ${formatTeamsMeetingLabel(options?.meeting?.provider)} Meeting`,
              url: meetingUrl,
              style: 'positive' as const,
            },
          ]
        : []),
      {
        type: 'Action.OpenUrl',
        title: 'View Incident ↗',
        url: safeUrl,
        ...(chatOpsActions.length ? { mode: 'secondary' } : {}),
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
    _opsknightMeta: { accent: statusAccent(eventType), eventType, state: visual.key, summary },
  };
}
