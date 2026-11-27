import { logger } from '../logger';
import type { EscalationExecutionResult } from './types';

/**
 * After an escalation step pages someone beyond the first step, refresh the incident's Slack and
 * Teams cards in place (escalation level, who is paged) and reply in their threads. Covers every
 * path that advances escalation: the timed queue job and manual requests from the web, API,
 * Slack or Teams. Step 0 is the initial page, which the trigger notification already shows.
 *
 * Best effort: the escalation is already durable, so a refresh failure is logged, never thrown.
 */
export async function refreshChatCardsAfterEscalation(
  incidentId: string,
  result: Pick<EscalationExecutionResult, 'outcome' | 'stepIndex'>
): Promise<void> {
  if (result.outcome !== 'STEP_EXECUTED' || !result.stepIndex || result.stepIndex < 1) return;
  try {
    const { sendServiceNotifications } = await import('../service-notifications');
    await sendServiceNotifications(incidentId, 'updated', { subEvent: 'escalated' });
  } catch (error) {
    logger.warn('escalation.chat_card_refresh_failed', {
      incidentId,
      stepIndex: result.stepIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
