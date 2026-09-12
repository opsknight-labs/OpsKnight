import type { IncidentChatProvider, ChatDeliveryResult } from '@/lib/chatops/provider';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { sendMicrosoftTeamsIncidentCard, updateMicrosoftTeamsIncidentCard, testMicrosoftTeamsConnection } from './client';

function incidentUrl(incidentId: string): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  return `${base}/incidents/${incidentId}`;
}

export class MicrosoftTeamsChatProvider implements IncidentChatProvider {
  readonly provider = 'MICROSOFT_TEAMS' as const;

  async sendIncidentCard(args: {
    destinationId: string;
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
      slaAckRemainingMs?: number | null;
      slaResolveRemainingMs?: number | null;
      acknowledgedBy?: string | null;
      resolvedBy?: string | null;
      createdAt: Date;
      acknowledgedAt?: Date | null;
      resolvedAt?: Date | null;
    };
    eventType: 'triggered' | 'acknowledged' | 'resolved';
  }): Promise<ChatDeliveryResult> {
    return this.createIncidentCard(args);
  }

  /** Canonical create: POST /teams/{team}/channels/{channel}/messages with Adaptive Card. Persists conversation+activity ledger. */
  async createIncidentCard(args: {
    destinationId: string;
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
      slaAckRemainingMs?: number | null;
      slaResolveRemainingMs?: number | null;
      acknowledgedBy?: string | null;
      resolvedBy?: string | null;
      createdAt: Date;
      acknowledgedAt?: Date | null;
      resolvedAt?: Date | null;
    };
    eventType: 'triggered' | 'acknowledged' | 'resolved';
  }): Promise<ChatDeliveryResult> {
    const dest = await prisma.microsoftTeamsDestination.findUnique({ where: { id: args.destinationId } });
    if (!dest) return { success: false, error: 'Teams destination not found', errorCode: 'DESTINATION_NOT_FOUND', statusCode: 404 };
    const url = args.incident.incidentUrl || incidentUrl(args.incident.id);
    const res = await sendMicrosoftTeamsIncidentCard({
      tenantId: dest.tenantId,
      teamId: dest.teamId,
      channelId: dest.channelId,
      incident: { ...args.incident, incidentUrl: url },
      eventType: args.eventType,
    });
    if (res.success && res.providerMessageId) {
      try {
        await prisma.microsoftTeamsIncidentMessage.upsert({
          where: { incidentId_destinationId: { incidentId: args.incident.id, destinationId: args.destinationId } },
          create: {
            incidentId: args.incident.id,
            destinationId: args.destinationId,
            messageId: res.providerMessageId,
            channelId: dest.channelId,
            tenantId: dest.tenantId,
            teamId: dest.teamId,
            conversationId: res.conversationId ?? null,
          },
          update: { messageId: res.providerMessageId, channelId: dest.channelId, tenantId: dest.tenantId, teamId: dest.teamId, conversationId: res.conversationId ?? undefined },
        });
      } catch (error) {
        // Delivery succeeded at provider — ledger failure must not flip to retry. Log and return success.
        logger.warn('[MicrosoftTeams] Incident message ledger upsert failed after successful send', {
          destinationId: args.destinationId,
          incidentId: args.incident.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return res;
  }

  /**
   * Canonical update: PATCH /teams/{team}/channels/{channel}/messages/{message}
   * Returns PATCH_NOT_SUPPORTED when app-only PATCH is restricted (policyViolation
   * only) — caller must NOT silently duplicate the card; surface DEGRADED instead.
   * Supports `disableActions` for terminal resolved state (Phase 2 seam).
   */
  async updateIncidentCard(args: {
    destinationId: string;
    messageId: string;
    conversationId?: string;
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
      slaAckRemainingMs?: number | null;
      slaResolveRemainingMs?: number | null;
      acknowledgedBy?: string | null;
      resolvedBy?: string | null;
      createdAt: Date;
      acknowledgedAt?: Date | null;
      resolvedAt?: Date | null;
    };
    eventType: 'triggered' | 'acknowledged' | 'resolved';
    disableActions?: boolean;
  }): Promise<ChatDeliveryResult> {
    const dest = await prisma.microsoftTeamsDestination.findUnique({ where: { id: args.destinationId } });
    if (!dest) return { success: false, error: 'Teams destination not found', errorCode: 'DESTINATION_NOT_FOUND', statusCode: 404 };
    const url = args.incident.incidentUrl || incidentUrl(args.incident.id);
    return updateMicrosoftTeamsIncidentCard({
      tenantId: dest.tenantId,
      teamId: dest.teamId,
      channelId: dest.channelId,
      messageId: args.messageId,
      incident: { ...args.incident, incidentUrl: url },
      eventType: args.eventType,
      disableActions: args.disableActions,
    });
  }

  /** Terminal state: re-render the canonical activity with actions disabled. */
  async disableActionsCard(args: {
    destinationId: string;
    messageId: string;
    conversationId?: string;
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
  }): Promise<ChatDeliveryResult> {
    return this.updateIncidentCard({ ...args, disableActions: true });
  }

  /**
   * Recover path: when the canonical message is 404 (deleted/expired), create a
   * fresh activity and re-ledger it. Caller should invoke this only on
   * MESSAGE_NOT_FOUND — not on PATCH_NOT_SUPPORTED.
   */
  async recoverIncidentCard(args: {
    destinationId: string;
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
      slaAckRemainingMs?: number | null;
      slaResolveRemainingMs?: number | null;
      acknowledgedBy?: string | null;
      resolvedBy?: string | null;
      createdAt: Date;
      acknowledgedAt?: Date | null;
      resolvedAt?: Date | null;
    };
    eventType: 'triggered' | 'acknowledged' | 'resolved';
  }): Promise<ChatDeliveryResult> {
    return this.createIncidentCard(args);
  }

  async testConnection(destinationId: string): Promise<ChatDeliveryResult> {
    return testMicrosoftTeamsConnection(destinationId);
  }
}

export const microsoftTeamsChatProvider = new MicrosoftTeamsChatProvider();
