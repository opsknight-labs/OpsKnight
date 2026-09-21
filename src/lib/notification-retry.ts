/**
 * Compatibility scheduler surface after retirement of legacy direct delivery.
 * All durable retries are owned by notification-control-plane.ts.
 */

export async function retryFailedNotifications(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  return { retried: 0, succeeded: 0, failed: 0 };
}

export async function getNextNotificationRetryAt(): Promise<Date | null> {
  return null;
}
