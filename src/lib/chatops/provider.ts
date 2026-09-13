/**
 * Provider-neutral ChatOps types.
 *
 * Slack remains the current ChatOps transport, but Teams must reuse the same
 * incident domain operations (executeChatOpsLifecycleCommand) without leaking
 * Slack-specific identifiers into shared business logic.
 *
 * Phase 1 introduces ChatProvider identity and a provider display contract.
 * Phase 2 adds Teams interactive execution via the same outbox.
 */
export type ChatProvider = 'SLACK' | 'MICROSOFT_TEAMS';

export const CHAT_PROVIDERS = ['SLACK', 'MICROSOFT_TEAMS'] as const;

export interface ChatProviderContext {
  provider: ChatProvider;
  /** Entra tenant id (Teams) or Slack workspace id (Slack) */
  tenantId: string;
  /** Teams teamId / Slack team_id */
  teamId?: string;
  conversationId?: string;
  channelId?: string;
  externalUserId?: string;
}

export type ChatDeliveryResult =
  | { success: true; providerMessageId?: string; conversationId?: string }
  | { success: false; error: string; statusCode?: number; retryAfterMs?: number; errorCode?: string };

/**
 * Presentation adapter. Implementations render provider-native cards and
 * deliver through the provider API. Business operations stay in the incident
 * domain (chatops-lifecycle), not in the adapter.
 *
 * Do not share Slack Block Kit and Teams Adaptive Cards via one renderer —
 * share the incident operation, not the presentation.
 */
export interface IncidentChatProvider {
  readonly provider: ChatProvider;
  sendIncidentCard(args: {
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
  }): Promise<ChatDeliveryResult>;
  updateIncidentCard(args: {
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
  }): Promise<ChatDeliveryResult>;
  testConnection(destinationId: string): Promise<ChatDeliveryResult>;
}

export function isChatProvider(value: unknown): value is ChatProvider {
  return value === 'SLACK' || value === 'MICROSOFT_TEAMS';
}

export function chatProviderLabel(provider: ChatProvider): string {
  return provider === 'SLACK' ? 'Slack' : 'Microsoft Teams';
}

export function chatProviderBadge(provider: ChatProvider): string {
  return provider === 'SLACK' ? 'SLACK' : 'MICROSOFT_TEAMS';
}
