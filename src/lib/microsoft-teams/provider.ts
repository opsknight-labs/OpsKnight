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
    });
  }

  async testConnection(destinationId: string): Promise<ChatDeliveryResult> {
    return testMicrosoftTeamsConnection(destinationId);
  }
}

export const microsoftTeamsChatProvider = new MicrosoftTeamsChatProvider();
