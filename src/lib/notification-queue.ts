/**
 * High-Performance Notification Queue
 *
 * Handles high-volume notification scenarios by:
 * 1. Batching notifications to reduce database writes
 * 2. Processing in parallel with configurable concurrency
 * 3. Rate limiting per channel to avoid external API throttling
 * 4. Deduplication to prevent spam
 *
 * For 100-500 concurrent users, this queue can handle 1000+ notifications/minute
 */

import { logger } from './logger';
import { NotificationChannel, sendNotification } from './notifications';
import { batchArray } from './db-utils';
import {
  notificationDedupeKey,
  notificationRetryDelayMs,
  NOTIFICATION_RETRY_POLICY,
  type NotificationEventType,
} from './notification-delivery';

// Queue configuration
const BATCH_SIZE = 50; // Process notifications in batches
const FLUSH_INTERVAL_MS = 1000; // Flush queue every second
const MAX_QUEUE_SIZE = 5000; // Maximum pending notifications
const CONCURRENCY_PER_CHANNEL = 10; // Parallel sends per channel

// Rate limits per channel (requests per minute)
const CHANNEL_RATE_LIMITS: Record<NotificationChannel, number> = {
  EMAIL: 100,
  SMS: 50,
  PUSH: 200,
  SLACK: 100,
  WEBHOOK: 100,
  WHATSAPP: 30,
};

interface QueuedNotification {
  incidentId: string;
  userId: string;
  channel: NotificationChannel;
  message: string;
  priority: number; // 1 = high, 2 = medium, 3 = low
  createdAt: number;
  dedupeKey: string;
  retryCount?: number;
  eventType: NotificationEventType;
}

interface ChannelState {
  lastMinuteCount: number;
  lastMinuteStart: number;
  processing: number;
}

// In-memory queue (for single-instance deployments)
// For multi-instance, this should be replaced with Redis
const queue: QueuedNotification[] = [];
const channelStates = new Map<NotificationChannel, ChannelState>();
const processedDedupeKeys = new Map<string, number>();
let flushTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
const pendingRetries = new Map<NodeJS.Timeout, QueuedNotification>();

function ensureFlushTimer(): void {
  if (!flushTimer && queue.length > 0) {
    flushTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS);
  }
}

function scheduleRetry(notification: QueuedNotification, delayMs: number): void {
  const timer = setTimeout(() => {
    pendingRetries.delete(timer);
    if (queue.length >= MAX_QUEUE_SIZE) {
      logger.warn('[NotificationQueue] Queue full, dropping retry', {
        incidentId: notification.incidentId,
        userId: notification.userId,
        channel: notification.channel,
      });
      return;
    }
    queue.push(notification);
    ensureFlushTimer();
  }, delayMs);
  pendingRetries.set(timer, notification);
}

/**
 * Initialize channel states
 */
function getChannelState(channel: NotificationChannel): ChannelState {
  if (!channelStates.has(channel)) {
    channelStates.set(channel, {
      lastMinuteCount: 0,
      lastMinuteStart: Date.now(),
      processing: 0,
    });
  }
  return channelStates.get(channel)!;
}

/**
 * Check if channel is within rate limit
 */
function isWithinRateLimit(channel: NotificationChannel): boolean {
  const state = getChannelState(channel);
  const now = Date.now();

  // Reset counter if a minute has passed
  if (now - state.lastMinuteStart >= 60000) {
    state.lastMinuteCount = 0;
    state.lastMinuteStart = now;
  }

  const limit = CHANNEL_RATE_LIMITS[channel];
  return state.lastMinuteCount < limit;
}

/**
 * Increment channel rate limit counter
 */
function incrementRateLimit(channel: NotificationChannel): void {
  const state = getChannelState(channel);
  state.lastMinuteCount++;
}

/**
 * Generate deduplication key
 */
/**
 * Add notification to queue
 */
export function queueNotification(
  incidentId: string,
  userId: string,
  channel: NotificationChannel,
  message: string,
  priority: number = 2,
  eventType: NotificationEventType = 'triggered'
): boolean {
  // Check queue size limit
  if (queue.length >= MAX_QUEUE_SIZE) {
    logger.warn('[NotificationQueue] Queue full, dropping notification', {
      incidentId,
      userId,
      channel,
      queueSize: queue.length,
    });
    return false;
  }

  const dedupeKey = notificationDedupeKey({ incidentId, userId, channel, message });

  // Check for duplicates
  if (
    processedDedupeKeys.has(dedupeKey) &&
    Date.now() - processedDedupeKeys.get(dedupeKey)! < 5 * 60 * 1000
  ) {
    logger.debug('[NotificationQueue] Duplicate notification skipped', {
      incidentId,
      userId,
      channel,
    });
    return false;
  }

  // Also check if already in queue
  const existsInQueue = queue.some(n => n.dedupeKey === dedupeKey);
  if (existsInQueue) {
    return false;
  }

  queue.push({
    incidentId,
    userId,
    channel,
    message,
    priority,
    createdAt: Date.now(),
    dedupeKey,
    eventType,
  });

  // Start flush timer if not running
  ensureFlushTimer();

  return true;
}

/**
 * Queue multiple notifications at once
 */
export function queueBulkNotifications(
  notifications: Array<{
    incidentId: string;
    userId: string;
    channel: NotificationChannel;
    message: string;
    priority?: number;
    eventType?: NotificationEventType;
  }>
): { queued: number; dropped: number; duplicates: number } {
  let queued = 0;
  let dropped = 0;
  let duplicates = 0;

  for (const n of notifications) {
    const dedupeKey = notificationDedupeKey(n);

    if (
      (processedDedupeKeys.has(dedupeKey) &&
        Date.now() - processedDedupeKeys.get(dedupeKey)! < 5 * 60 * 1000) ||
      queue.some(q => q.dedupeKey === dedupeKey)
    ) {
      duplicates++;
      continue;
    }

    if (queue.length >= MAX_QUEUE_SIZE) {
      dropped++;
      continue;
    }

    queue.push({
      ...n,
      priority: n.priority || 2,
      createdAt: Date.now(),
      dedupeKey,
      eventType: n.eventType ?? 'triggered',
    });
    queued++;
  }

  // Start flush timer if not running
  if (queued > 0) ensureFlushTimer();

  return { queued, dropped, duplicates };
}

/**
 * Process and flush the queue
 */
async function flushQueue(): Promise<void> {
  if (isProcessing || queue.length === 0) {
    return;
  }

  isProcessing = true;

  try {
    // Sort by priority (high first) and age (older first)
    queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    // Take a batch
    const batch = queue.splice(0, BATCH_SIZE);

    // Group by channel for efficient processing
    const byChannel = new Map<NotificationChannel, QueuedNotification[]>();
    for (const n of batch) {
      if (!byChannel.has(n.channel)) {
        byChannel.set(n.channel, []);
      }
      byChannel.get(n.channel)!.push(n);
    }

    // Process each channel's notifications
    const channelPromises: Promise<void>[] = [];

    for (const [channel, notifications] of byChannel) {
      channelPromises.push(processChannelNotifications(channel, notifications));
    }

    await Promise.allSettled(channelPromises);

    // Stop timer if queue is empty
    if (queue.length === 0 && flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  } catch (error) {
    logger.error('[NotificationQueue] Flush error', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isProcessing = false;
  }
}

/**
 * Process notifications for a single channel
 */
async function processChannelNotifications(
  channel: NotificationChannel,
  notifications: QueuedNotification[]
): Promise<void> {
  const state = getChannelState(channel);

  // Process in parallel batches respecting concurrency limit
  const batches = batchArray(notifications, CONCURRENCY_PER_CHANNEL);

  for (const batch of batches) {
    // Filter out notifications that exceed rate limit
    const toProcess: QueuedNotification[] = [];

    for (const n of batch) {
      if (isWithinRateLimit(channel)) {
        toProcess.push(n);
        incrementRateLimit(channel);
      } else {
        // Re-queue rate-limited notifications with backoff
        const retryCount = (n.retryCount || 0) + 1;
        if (retryCount <= NOTIFICATION_RETRY_POLICY.maxAttempts) {
          const delayMs = notificationRetryDelayMs(retryCount);
          scheduleRetry({ ...n, priority: Math.min(n.priority + 1, 3), retryCount }, delayMs);
        } else {
          logger.error('[NotificationQueue] Notification permanently dropped due to rate limits', {
            incidentId: n.incidentId,
            userId: n.userId,
            channel: n.channel,
          });
        }
      }
    }

    if (toProcess.length === 0) continue;

    // Process in parallel
    state.processing += toProcess.length;

    const results = await Promise.allSettled(
      toProcess.map(async n => {
        try {
          const result = await sendNotification(
            n.incidentId,
            n.userId,
            n.channel,
            n.message,
            undefined,
            n.eventType
          );

          // Notification providers report expected delivery failures in their
          // result instead of throwing. Treat those results as failures so the
          // queue's retry policy is actually applied.
          if (!result.success && !result.terminal) {
            throw new Error(result.error || `${n.channel} notification delivery failed`);
          }

          // Permanent failures are terminal for this attempt, but they are not
          // successful deliveries and must not poison the in-memory dedupe
          // cache. A configuration fix (for example, adding a webhook URL)
          // should allow the same notification to be enqueued immediately.
          if (!result.success && result.terminal && !result.skipped) {
            return { notification: n, result, terminalFailure: true };
          }

          // Record dedupe only after confirmed delivery or an intentional skip.
          processedDedupeKeys.set(n.dedupeKey, Date.now());

          // Clean old dedupe keys periodically (keep last 10 minutes)
          if (processedDedupeKeys.size > 10000) {
            const now = Date.now();
            for (const [key, timestamp] of processedDedupeKeys.entries()) {
              if (now - timestamp > 10 * 60 * 1000) {
                processedDedupeKeys.delete(key);
              }
            }
          }

          return { notification: n, result };
        } catch (error) {
          throw { notification: n, error };
        }
      })
    );

    state.processing -= toProcess.length;

    // Log batch results
    const succeeded = results.filter(
      r => r.status === 'fulfilled' && !r.value.terminalFailure
    ).length;
    const terminalFailures = results.filter(
      r => r.status === 'fulfilled' && r.value.terminalFailure
    );
    const failed = results.filter(r => r.status === 'rejected').length + terminalFailures.length;

    for (const failure of terminalFailures) {
      if (failure.status !== 'fulfilled') continue;
      logger.error('[NotificationQueue] Notification permanently failed', {
        incidentId: failure.value.notification.incidentId,
        userId: failure.value.notification.userId,
        channel: failure.value.notification.channel,
        error: failure.value.result.error,
      });
    }

    for (const result of results) {
      if (result.status === 'rejected') {
        const { notification, error } = result.reason;
        const retryCount = (notification.retryCount || 0) + 1;

        if (retryCount <= NOTIFICATION_RETRY_POLICY.maxAttempts) {
          scheduleRetry({ ...notification, retryCount }, notificationRetryDelayMs(retryCount));
        } else {
          logger.error('[NotificationQueue] Notification permanently dropped after 3 retries', {
            incidentId: notification.incidentId,
            userId: notification.userId,
            channel: notification.channel,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (failed > 0) {
      logger.warn('[NotificationQueue] Batch completed with failures', {
        channel,
        succeeded,
        failed,
      });
    }
  }
}

/**
 * Get queue statistics
 */
export function getQueueStats(): {
  pending: number;
  byChannel: Record<NotificationChannel, number>;
  processing: Record<NotificationChannel, number>;
  rateLimits: Record<NotificationChannel, { used: number; limit: number }>;
} {
  const byChannel: Partial<Record<NotificationChannel, number>> = {};
  const processing: Partial<Record<NotificationChannel, number>> = {};
  const rateLimits: Partial<Record<NotificationChannel, { used: number; limit: number }>> = {};

  for (const n of queue) {
    byChannel[n.channel] = (byChannel[n.channel] || 0) + 1;
  }

  for (const [channel, state] of channelStates) {
    processing[channel] = state.processing;
    rateLimits[channel] = {
      used: state.lastMinuteCount,
      limit: CHANNEL_RATE_LIMITS[channel],
    };
  }

  return {
    pending: queue.length,
    byChannel: byChannel as Record<NotificationChannel, number>,
    processing: processing as Record<NotificationChannel, number>,
    rateLimits: rateLimits as Record<NotificationChannel, { used: number; limit: number }>,
  };
}

/**
 * Force flush the queue (for graceful shutdown)
 */
export async function forceFlush(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  for (const [timer, notification] of pendingRetries) {
    clearTimeout(timer);
    if (queue.length < MAX_QUEUE_SIZE) queue.push(notification);
  }
  pendingRetries.clear();

  // Process remaining items
  while (queue.length > 0) {
    await flushQueue();
  }
}

/**
 * Clear the queue (for testing)
 */
export function clearQueue(): void {
  queue.length = 0;
  for (const timer of pendingRetries.keys()) clearTimeout(timer);
  pendingRetries.clear();
  processedDedupeKeys.clear();
  channelStates.clear();

  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
