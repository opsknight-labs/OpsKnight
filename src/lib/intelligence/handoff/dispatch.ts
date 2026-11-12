import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { getIntelligenceSettings } from '../settings/service';
import { buildHandoffSummary, draftHandoffNarrative, renderHandoffSummary } from './summary';

export interface HandoffRecipient {
  userId: string;
  email: string | null;
  shiftStart: Date;
}

/**
 * Sends the shift handoff summary to each incoming responder of a rotation. Off unless the operator turned
 * on "Send shift handoff summaries". Delivery goes through the durable notification control plane, which
 * de-duplicates on (recipient, schedule, shift), so a rotation processed twice never mails twice. Returns
 * how many summaries were queued; never throws.
 */
export async function sendHandoffSummaries(input: {
  scheduleId: string;
  scheduleName: string;
  serviceIds: readonly string[];
  recipients: readonly HandoffRecipient[];
  now?: Date;
}): Promise<number> {
  let sent = 0;
  try {
    if (!(await getIntelligenceSettings()).handoffSummaryEnabled) return 0;
    if (input.serviceIds.length === 0 || input.recipients.length === 0) return 0;
    const now = input.now ?? new Date();
    const summary = await buildHandoffSummary(
      {
        scheduleId: input.scheduleId,
        scheduleName: input.scheduleName,
        serviceIds: input.serviceIds,
        now,
      },
      prisma
    );
    const appUrl = getBaseUrl();
    for (const recipient of input.recipients) {
      const narrative = await draftHandoffNarrative(summary, recipient.userId);
      const email = renderHandoffSummary({ ...summary, narrative }, appUrl);
      await createInAppNotifications({
        userIds: [recipient.userId],
        type: 'SCHEDULE',
        title: 'Shift handoff summary',
        message: email.subject,
        entityType: 'SCHEDULE',
        entityId: input.scheduleId,
      });
      if (recipient.email) {
        const result = await enqueueCentralNotification({
          category: 'SYSTEM',
          channel: 'EMAIL',
          recipientType: 'USER',
          recipientId: recipient.userId,
          recipientAddress: recipient.email,
          userId: recipient.userId,
          templateKey: 'intelligence-shift-handoff',
          sourceType: 'ON_CALL_SCHEDULE',
          sourceId: input.scheduleId,
          eventKey: `${input.scheduleId}-${recipient.userId}-${recipient.shiftStart.getTime()}-intelligence-handoff`,
          displayMessage: email.subject,
          priority: 2,
          expiresAt: new Date(now.getTime() + 12 * 3_600_000),
          payload: {
            kind: 'EMAIL',
            to: recipient.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
        });
        if (!result.skipped) sent += 1;
      } else {
        sent += 1;
      }
    }
  } catch (error) {
    logger.warn('[Intelligence] Shift handoff summary failed', {
      scheduleId: input.scheduleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return sent;
}
