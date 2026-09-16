import type { WarRoomProjectionModel } from '../../projection-model';
import { CHATOPS_ACTIONS, type ChatOpsActionKind } from '@/lib/chatops/action-contract';
import { teamsVerbForChatOpsKind } from '@/lib/chatops/teams-action-map';
import { buildMicrosoftTeamsIncidentCard } from '@/lib/microsoft-teams/cards';

/**
 * Thin adapter — lifecycle and persistence free.
 *
 * Historically this file held a standalone Adaptive Card template that drifted
 * from `lib/microsoft-teams/cards.ts`. It now delegates to the single
 * war-room contract so every renderer sees the same 10-action set and no
 * provider duplicates its action definitions.
 *
 * Projection owns phase + capability filtering; this renderer only maps the
 * resulting `model.actions` to `Action.Execute` / `Action.ShowCard`. Provider
 * transport (Bot Connector, Graph) remains in `lib/microsoft-teams/client.ts`.
 */
export function renderMicrosoftTeamsWarRoomProjection(
  model: WarRoomProjectionModel,
  opts?: {
    destinationId?: string;
    messageGeneration?: number;
    warRoomId?: string;
    refreshUserIds?: string[];
    slaAckRemainingMs?: number | null;
    slaResolveRemainingMs?: number | null;
  }
) {
  // Prefer the rich incident-card builder when destination context is present
  // (war-room and canonical cards both need serviceUrl/bot identity + refresh).
  // Fall back to the minimal contract-driven card for unit tests that only
  // assert phase/action policy.
  if (opts?.destinationId != null && opts.messageGeneration != null) {
    const phase = model.phase;
    const eventType: 'triggered' | 'acknowledged' | 'resolved' =
      phase === 'RESOLVED' ? 'resolved' : phase === 'ACKNOWLEDGED' ? 'acknowledged' : 'triggered';
    const incident = {
      id: model.incident.id,
      title: model.incident.title,
      description: model.incident.description,
      status: model.incident.status,
      urgency: model.incident.urgency,
      priority: model.incident.priority,
      serviceName: model.incident.serviceName,
      assigneeName: model.incident.assigneeName,
      incidentUrl: model.incident.url,
      createdAt: model.incident.createdAt,
      acknowledgedAt: model.incident.acknowledgedAt,
      resolvedAt: model.incident.resolvedAt,
      slaAckRemainingMs: opts.slaAckRemainingMs ?? null,
      slaResolveRemainingMs: opts.slaResolveRemainingMs ?? null,
    };
    // Re-derive capabilities from the already-filtered model.actions so the
    // rich card does not second-guess projection — it renders exactly what
    // projection offered.
    const offered = new Set(model.actions as readonly ChatOpsActionKind[]);
    const capabilities: Record<string, boolean> = {};
    for (const [kind, meta] of Object.entries(CHATOPS_ACTIONS) as Array<
      [ChatOpsActionKind, (typeof CHATOPS_ACTIONS)[ChatOpsActionKind]]
    >) {
      if (meta.capability) capabilities[meta.capability] = offered.has(kind);
    }
    return buildMicrosoftTeamsIncidentCard(
      { incident, eventType },
      {
        disableActions: phase === 'RESOLVED',
        meeting: model.meeting,
        interactive: {
          destinationId: opts.destinationId,
          messageGeneration: opts.messageGeneration,
          ...(opts.warRoomId ? { warRoomId: opts.warRoomId } : {}),
          ...(opts.refreshUserIds?.length ? { refreshUserIds: opts.refreshUserIds } : {}),
          capabilities: capabilities as never,
        },
      }
    );
  }

  // Minimal contract-driven card — no transport context, no SLA, no refresh.
  // Used by `war-room-projection-model.test.ts` and other pure unit tests.
  const actions: Array<{
    type: string;
    title: string;
    verb?: string;
    data?: Record<string, unknown>;
    url?: string;
  }> = model.actions.map(kind => {
    const meta = CHATOPS_ACTIONS[kind as ChatOpsActionKind];
    // ShowCard actions (note/priority/snooze) require a card host — without
    // destination context we emit a plain Execute so tests can assert length
    // without needing to fixture Team destinations.
    let verb: string;
    try {
      verb = teamsVerbForChatOpsKind(kind as ChatOpsActionKind);
    } catch {
      verb = String(kind).toLowerCase();
    }
    return {
      type: 'Action.Execute' as const,
      title: meta?.title ?? String(kind),
      verb,
      data: { incidentId: model.incident.id },
    };
  });
  if (model.meeting?.joinUrl && model.phase !== 'RESOLVED') {
    const p = model.meeting.provider;
    const label =
      p === 'MICROSOFT_TEAMS'
        ? 'Teams'
        : p === 'ZOOM'
          ? 'Zoom'
          : p === 'GOOGLE_MEET'
            ? 'Google Meet'
            : p === 'JITSI'
              ? 'Jitsi'
              : 'Video';
    actions.unshift({
      type: 'Action.OpenUrl',
      title: `Join ${label} Meeting`,
      url: model.meeting.joinUrl,
    });
  }
  return {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: model.incident.title },
      {
        type: 'FactSet',
        facts: [
          { title: 'Status', value: model.incident.status },
          { title: 'Urgency', value: model.incident.urgency },
          { title: 'Service', value: model.incident.serviceName },
          ...(model.incident.assigneeName
            ? [{ title: 'Assignee', value: model.incident.assigneeName }]
            : []),
        ],
      },
    ],
    actions,
  };
}
