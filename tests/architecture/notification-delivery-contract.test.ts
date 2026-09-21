import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('notification delivery architecture', () => {
  it('routes initial sends and retries through the durable control plane', () => {
    const initialDelivery = readFileSync('src/lib/notifications.ts', 'utf8');
    const retryDelivery = readFileSync('src/lib/notification-retry.ts', 'utf8');

    expect(initialDelivery).toContain('enqueueCentralNotification');
    expect(retryDelivery).toContain('notification-control-plane.ts');
    expect(retryDelivery).not.toContain('dispatchNotificationAttempt');
  });

  it('keeps retry and idempotency policy centralized', () => {
    const queue = readFileSync('src/lib/notification-control-plane.ts', 'utf8');
    const retry = readFileSync('src/lib/notification-retry.ts', 'utf8');

    expect(queue).toContain('deliveryKey');
    expect(queue).toContain('notificationRetryDelayMs');
    expect(retry).not.toContain('notificationRetryDelayMs');
    expect(retry).not.toContain('dispatchNotificationAttempt');
  });

  it('does not fire-and-forget personal incident notifications from API adapters', () => {
    const slackActions = readFileSync('src/app/api/slack/actions/route.ts', 'utf8');
    const providerCommands = readFileSync('src/lib/chatops/commands.ts', 'utf8');
    const chatOpsCommands = readFileSync('src/lib/incidents/chatops-lifecycle.ts', 'utf8');

    expect(slackActions).toContain('executeChatOpsCommand');
    expect(providerCommands).toContain('executeChatOpsAssignment');
    expect(chatOpsCommands).toContain('enqueueIncidentUpdateSideEffects');
    expect(slackActions).not.toContain("import('@/lib/user-notifications')");
    expect(slackActions).not.toMatch(/sendIncidentNotifications\s*\(/);
  });
});
