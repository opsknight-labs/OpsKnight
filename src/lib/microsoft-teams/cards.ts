import { sanitizeUrl } from '@/lib/email-components';

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
  };
  eventType: 'triggered' | 'acknowledged' | 'resolved';
};

export type MicrosoftTeamsCardOptions = {
  /** When true, render card with actions disabled (e.g. resolved terminal state). */
  disableActions?: boolean;
};

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
  const foot =
    disableActions && eventType === 'resolved'
      ? `Resolved — actions disabled`
      : eventType === 'acknowledged' && incident.acknowledgedBy
        ? `Acknowledged by ${incident.acknowledgedBy}`
        : eventType === 'resolved' && incident.resolvedBy
          ? `Resolved by ${incident.resolvedBy}`
          : `Created ${incident.createdAt.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

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
                  { type: 'TextBlock', text: `OpsKnight · ${statusBadge(eventType)}`, weight: 'Bolder', size: 'Medium', color: 'Attention', wrap: true },
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
    actions: disableActions
      ? [
          {
            type: 'Action.OpenUrl',
            title: 'View Incident ↗',
            url: safeUrl,
          },
        ]
      : [
          {
            type: 'Action.OpenUrl',
            title: 'View Incident ↗',
            url: safeUrl,
          },
        ],
    // Phase 2 note: ACK/Resolve/Assign will use Action.Execute with verb `opsknight.ack` etc.
    // and route through POST /api/microsoft-teams/messages as `invoke` activity.
    // Intentionally omitted in Phase 1 per spec — prepare the architecture, not the buttons.
    // Accent color is carried by the header emphasis; Adaptive Cards have no standard `accentColor` prop,
    // so do not rely on it for accessibility — the status badge text is the semantic signal.
    _opsknightMeta: { accent: statusAccent(eventType), eventType },
  };
}


