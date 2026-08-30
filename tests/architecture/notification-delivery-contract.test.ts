import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('notification delivery architecture', () => {
  it('keeps initial sends and retries on the same channel dispatcher', () => {
    const initialDelivery = readFileSync('src/lib/notifications.ts', 'utf8');
    const retryDelivery = readFileSync('src/lib/notification-retry.ts', 'utf8');

    for (const source of [initialDelivery, retryDelivery]) {
      expect(source).toContain('dispatchNotificationAttempt');
      expect(source).not.toMatch(/import\(['"]\.\/(?:email|sms|push|whatsapp|webhooks)['"]\)/);
      expect(source).not.toMatch(/sendIncident(?:Email|SMS|Push|WhatsApp|Webhook)/);
    }
  });

  it('keeps retry and idempotency policy centralized', () => {
    const queue = readFileSync('src/lib/notification-queue.ts', 'utf8');
    const retry = readFileSync('src/lib/notification-retry.ts', 'utf8');

    expect(queue).toContain('notificationDedupeKey');
    expect(queue).toContain('notificationRetryDelayMs');
    expect(retry).toContain('notificationRetryDelayMs');
    expect(queue).not.toMatch(/Math\.pow\(2,\s*retryCount\)/);
    expect(retry).not.toContain('INITIAL_RETRY_DELAY_MS');
  });

  it('does not fire-and-forget personal incident notifications from API adapters', () => {
    const slackActions = readFileSync('src/app/api/slack/actions/route.ts', 'utf8');

    expect(slackActions).toContain('enqueueIncidentUpdateSideEffects');
    expect(slackActions).not.toContain("import('@/lib/user-notifications')");
    expect(slackActions).not.toMatch(/sendIncidentNotifications\s*\(/);
  });
});
