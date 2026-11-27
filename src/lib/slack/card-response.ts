/**
 * After a button on an OpsKnight incident card succeeds, replace that card (via the interaction's
 * response_url) with its fresh state, and tell only the clicker what happened.
 */
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { callSlackApi } from './api';
import { buildIncidentCard, isOpsKnightIncidentCard } from './incident-card';
import { loadSlackCardIncident } from './live-card';

export async function refreshedIncidentCardResponse(input: {
  incidentId: string;
  serviceId: string;
  /** `payload.message` of the interaction: only our own cards are replaced. */
  message: unknown;
  channelId?: string;
  slackUserId?: string;
  confirmation: string;
}): Promise<Record<string, unknown> | null> {
  if (!isOpsKnightIncidentCard(input.message)) return null;
  const { getSlackInstall } = await import('@/lib/slack');
  const install = await getSlackInstall(input.serviceId);
  if (!install) return null;
  const loaded = await loadSlackCardIncident(input.incidentId, install);
  if (!loaded) return null;
  const card = buildIncidentCard(loaded.incident, { appUrl: getBaseUrl(), interactive: true });
  if (input.channelId && input.slackUserId) {
    const sent = await callSlackApi('chat.postEphemeral', install.token, {
      channel: input.channelId,
      user: input.slackUserId,
      text: input.confirmation,
    });
    if (!sent.ok)
      logger.warn('[Slack Actions] Ephemeral confirmation failed', { error: sent.error });
  }
  return {
    replace_original: true,
    text: card.text,
    blocks: card.blocks,
    attachments: card.attachments,
  };
}
