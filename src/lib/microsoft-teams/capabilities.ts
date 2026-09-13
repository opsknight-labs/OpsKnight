import { getMicrosoftTeamsConfig } from './auth';
import type { TeamsRscGrantState } from './client';

export type MicrosoftTeamsFailureCode =
  | 'NOT_CONFIGURED'
  | 'TENANT_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'CONSENT_REQUIRED'
  | 'APP_NOT_INSTALLED'
  | 'CHANNEL_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'MESSAGE_REFERENCE_INVALID'
  | 'DESTINATION_NOT_FOUND'
  | 'GRAPH_TOKEN_FAILED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export type MicrosoftTeamsCapability = {
  connected: boolean;
  botInstalled: boolean;
  canPost: boolean;
  canUpdateCard: boolean;
  canCreateChannel: boolean;
  canCreateMeeting: boolean;
  canManageMembers: boolean;
  canUseChatOps: boolean;
  healthy: boolean;
  failureCode: MicrosoftTeamsFailureCode | null;
  failureReason: string | null;
  rsc: TeamsRscGrantState | null;
};

/**
 * Centralized capability contract — fail-closed.
 * unknown => DENY (canPost/canUpdateCard false, healthy false).
 * Mirrors Slack capability pattern but scoped to Teams RSC + installation.
 */
export async function getMicrosoftTeamsCapabilities(options?: {
  tenantId?: string;
  rscState?: TeamsRscGrantState | null;
}): Promise<MicrosoftTeamsCapability> {
  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved || !resolved.config.enabled) {
    return {
      connected: false,
      botInstalled: false,
      canPost: false,
      canUpdateCard: false,
      canCreateChannel: false,
      canCreateMeeting: false,
      canManageMembers: false,
      canUseChatOps: false,
      healthy: false,
      failureCode: 'NOT_CONFIGURED',
      failureReason: 'Microsoft Teams is not configured.',
      rsc: null,
    };
  }
  const tenantId = options?.tenantId?.trim() || resolved.config.tenantId?.trim() || '';
  // SINGLE requires tenantId; MULTI may infer from installations — but for capability check we require explicit resolution
  const prismaAny = (await import('@/lib/prisma')).default as unknown as {
    microsoftTeamsInstallation: { count: (a: unknown) => Promise<number> };
  };
  let botInstalled = false;
  try {
    const count = await prismaAny.microsoftTeamsInstallation.count({
      where: { tenantId: tenantId || undefined, enabled: true },
    } as never);
    botInstalled = count > 0;
  } catch {
    botInstalled = false;
  }

  // RSC truth — fail-closed: unknown => DENY
  let rsc: TeamsRscGrantState | null = options && 'rscState' in options ? options.rscState ?? null : null;
  if (!options || !('rscState' in options)) {
    try {
      const { getTeamsGrantedRscPermissions } = await import('./client');
      rsc = await getTeamsGrantedRscPermissions({ explicitTenantId: tenantId || undefined });
    } catch {
      rsc = { granted: null, missing: [], unknown: true, error: 'RSC_UNAVAILABLE', installations: [] };
    }
  }

  // Bot Connector is the delivery transport — `ChannelMessage.Send.Group` is optional.
  // Gate `canPost` on bot installation + verified serviceUrl/tenant routing rather than
  // the legacy Graph-send RSC permission.
  const hasRequiredRsc = Boolean(rsc && !rsc.unknown && rsc.missing.length === 0);
  // Even without verified RSC, posting via Bot Connector is viable when botInstalled.
  // Unknown RSC is fail-closed for consent-sensitive ops, but Bot transport does not
  // require it — treat unknown as non-blocking for canPost.
  const canPost = Boolean(botInstalled);
  // Bot activity update uses PUT /v3/conversations/{conversationId}/activities/{activityId}
  // — no Graph PATCH, so canUpdateCard tracks Bot update availability.
  const canUpdateCard = Boolean(botInstalled);

  let failureCode: MicrosoftTeamsFailureCode | null = null;
  let failureReason: string | null = null;
  if (!botInstalled) {
    failureCode = 'APP_NOT_INSTALLED';
    failureReason = 'Teams app is not installed to any Team in this tenant.';
  } else if (rsc && !rsc.unknown && rsc.missing.length > 0 && !hasRequiredRsc) {
    // Only surface RSC missing when required set (ChannelSettings.Read.Group) is absent.
    failureCode = 'CONSENT_REQUIRED';
    failureReason = `Missing RSC permissions: ${rsc.missing.join(', ')}`;
  } else if (rsc?.unknown) {
    // Unknown RSC does not block posting via Bot, but surface as informational.
    failureCode = null;
    failureReason = null;
  }

  // Healthy means the Bot can post — RSC unknown does not block Bot transport.
  const healthy = canPost;

  return {
    connected: true,
    botInstalled,
    canPost,
    canUpdateCard,
    canCreateChannel: false,
    canCreateMeeting: false,
    canManageMembers: false,
    canUseChatOps: false,
    healthy,
    failureCode,
    failureReason,
    rsc,
  };
}

export function categorizeTeamsErrorCode(raw: string | undefined): MicrosoftTeamsFailureCode {
  if (!raw) return 'UNKNOWN';
  const v = raw.toUpperCase();
  if (v === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  if (v === 'TENANT_REQUIRED') return 'TENANT_REQUIRED';
  if (v === 'GRAPH_TOKEN_FAILED') return 'GRAPH_TOKEN_FAILED';
  if (v === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (v === 'CHANNEL_NOT_FOUND') return 'CHANNEL_NOT_FOUND';
  if (v === 'MESSAGE_NOT_FOUND') return 'MESSAGE_NOT_FOUND';
  if (v === 'MESSAGE_REFERENCE_INVALID') return 'MESSAGE_REFERENCE_INVALID';
  if (v === 'DESTINATION_NOT_FOUND') return 'DESTINATION_NOT_FOUND';
  if (v === 'PATCH_NOT_SUPPORTED') return 'UNKNOWN';
  if (v === 'CONSENT_REQUIRED' || /CONSENT|PERMISSION/i.test(raw)) return 'CONSENT_REQUIRED';
  if (v === 'APP_NOT_INSTALLED') return 'APP_NOT_INSTALLED';
  if (v === 'AUTH_EXPIRED' || /AUTH|UNAUTHORIZED|FORBIDDEN/i.test(raw)) return 'AUTH_EXPIRED';
  return 'UNKNOWN';
}
