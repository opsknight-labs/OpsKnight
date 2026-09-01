import 'server-only';

import crypto from 'crypto';
import {
  Prisma,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationRecipientType,
} from '@prisma/client';
import prisma from './prisma';
import { CircuitBreakerError, CircuitBreakers } from './circuit-breaker';
import { decrypt, encrypt, getEncryptionKey } from './encryption';
import {
  acquireProviderAdmission,
  deferProviderAdmission,
  type ProviderAdmissionScope,
} from './provider-admission';
import { notificationRetryDelayMs, NOTIFICATION_RETRY_POLICY } from './notification-delivery';

const MAX_ENCRYPTED_PAYLOAD_BYTES = 768 * 1024;
const MAX_ERROR_LENGTH = 1_000;
// This lease exceeds every adapter timeout. Reclaiming an active provider call can
// produce a duplicate on channels that do not support provider-side idempotency.
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const SYSTEM_NOTIFICATION_BATCH_SIZE = 100;
const SYSTEM_NOTIFICATION_CONCURRENCY = 10;
const SECURITY_PAYLOAD_CLEANUP_BATCH_SIZE = 100;

type IncidentPresentation = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assigneeName?: string;
};

export type CentralNotificationPayload =
  | {
      kind: 'EMAIL';
      to: string;
      subject: string;
      html: string;
      text?: string;
      providerScope?: { statusPageId: string };
    }
  | { kind: 'SMS'; to: string; message: string }
  | { kind: 'WHATSAPP'; to: string; message: string; from?: string }
  | {
      kind: 'PUSH';
      userId: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      badge?: number;
    }
  | {
      kind: 'SLACK_CHANNEL';
      channel: string;
      incident: IncidentPresentation;
      eventType: 'triggered' | 'acknowledged' | 'resolved';
      includeInteractiveButtons?: boolean;
      serviceId?: string;
      additionalMessage?: string;
    }
  | {
      kind: 'SLACK_WEBHOOK';
      incident: IncidentPresentation;
      eventType: 'triggered' | 'acknowledged' | 'resolved';
      webhookUrl?: string;
      additionalMessage?: string;
    }
  | {
      kind: 'WEBHOOK';
      url: string;
      payload: Record<string, unknown>;
      headers?: Record<string, string>;
      secret?: string;
      method?: 'POST' | 'PUT' | 'PATCH';
      timeout?: number;
    }
  | {
      kind: 'STATUS_PAGE_WEBHOOK';
      url: string;
      secret: string;
      payload: { event: string; timestamp: string; data: unknown };
      deliveryId: string;
    };

export type CentralNotificationInput = {
  category: NotificationCategory;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  recipientId?: string;
  recipientAddress: string;
  userId?: string;
  incidentId?: string;
  templateKey: string;
  sourceType: string;
  sourceId: string;
  eventKey: string;
  displayMessage: string;
  payload: CentralNotificationPayload;
  priority?: number;
  scheduledAt?: Date;
  expiresAt?: Date;
  maxAttempts?: number;
};

type NotificationStore = Pick<Prisma.TransactionClient, 'notification'>;

type DeliveryResult = {
  success: boolean;
  error?: string;
  providerMessageId?: string;
  statusCode?: number;
  retryAfterMs?: number;
};

function normalizedRecipient(channel: NotificationChannel, recipient: string): string {
  const value = recipient.trim();
  if (channel === 'EMAIL') return value.toLowerCase();
  if (channel === 'SMS' || channel === 'WHATSAPP') return value.replace(/[\s().-]/g, '');
  return value;
}

export function maskedNotificationRecipient(
  channel: NotificationChannel,
  recipient: string
): string {
  const value = normalizedRecipient(channel, recipient);
  if (channel === 'EMAIL') {
    const separator = value.lastIndexOf('@');
    if (separator <= 0) return '***';
    const local = value.slice(0, separator);
    return `${local.slice(0, 1)}***@${value.slice(separator + 1)}`;
  }
  if (channel === 'SMS' || channel === 'WHATSAPP') {
    return value.length > 4 ? `***${value.slice(-4)}` : '***';
  }
  if (channel === 'WEBHOOK') {
    try {
      return new URL(value).origin;
    } catch {
      return 'Webhook endpoint';
    }
  }
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}

function recipientDigest(channel: NotificationChannel, recipient: string): string {
  const key = getEncryptionKey();
  if (!key) throw new Error('Notification encryption is not configured');
  return crypto
    .createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${channel}\u001f${normalizedRecipient(channel, recipient)}`)
    .digest('hex');
}

function stableDigest(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function intentId(deliveryKey: string): string {
  return `notification_${deliveryKey.slice(0, 31)}`;
}

function channelForPayload(payload: CentralNotificationPayload): NotificationChannel {
  if (payload.kind === 'SLACK_CHANNEL' || payload.kind === 'SLACK_WEBHOOK') return 'SLACK';
  if (payload.kind === 'STATUS_PAGE_WEBHOOK') return 'WEBHOOK';
  return payload.kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCentralNotificationPayload(value: unknown): value is CentralNotificationPayload {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'EMAIL':
      return hasText(value.to) && hasText(value.subject) && hasText(value.html);
    case 'SMS':
    case 'WHATSAPP':
      return hasText(value.to) && hasText(value.message);
    case 'PUSH':
      return hasText(value.userId) && hasText(value.title) && hasText(value.body);
    case 'SLACK_CHANNEL':
      return hasText(value.channel) && isRecord(value.incident) && hasText(value.incident.id);
    case 'SLACK_WEBHOOK':
      return isRecord(value.incident) && hasText(value.incident.id);
    case 'WEBHOOK':
      return hasText(value.url) && isRecord(value.payload);
    case 'STATUS_PAGE_WEBHOOK':
      return (
        hasText(value.url) &&
        hasText(value.secret) &&
        hasText(value.deliveryId) &&
        isRecord(value.payload) &&
        hasText(value.payload.event) &&
        hasText(value.payload.timestamp)
      );
    default:
      return false;
  }
}

function assertValidInput(input: CentralNotificationInput): void {
  if (!isCentralNotificationPayload(input.payload)) {
    throw new Error('Notification payload is incomplete or unsupported');
  }
  if (channelForPayload(input.payload) !== input.channel) {
    throw new Error('Notification payload does not match the selected channel');
  }
  if (!input.templateKey.trim() || !input.sourceType.trim() || !input.sourceId.trim()) {
    throw new Error('Notification template and source identity are required');
  }
  if (!input.eventKey.trim()) throw new Error('A stable notification event key is required');
  if (input.expiresAt && input.scheduledAt && input.expiresAt <= input.scheduledAt) {
    throw new Error('Notification expiry must be later than its scheduled time');
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function createCentralNotificationIntent(
  input: CentralNotificationInput,
  store: NotificationStore = prisma
): Promise<{ id: string; created: boolean }> {
  assertValidInput(input);
  const recipientHash = recipientDigest(input.channel, input.recipientAddress);
  const deliveryKey = stableDigest(
    input.category,
    input.channel,
    recipientHash,
    input.templateKey,
    input.sourceType,
    input.sourceId,
    input.eventKey
  );
  const serializedPayload = JSON.stringify(input.payload);
  if (Buffer.byteLength(serializedPayload, 'utf8') > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error('Notification payload exceeds the durable delivery limit');
  }
  const payloadEncrypted = await encrypt(serializedPayload);
  const scheduledAt = input.scheduledAt ?? new Date();
  const maxAttempts = Math.min(
    Math.max(input.maxAttempts ?? NOTIFICATION_RETRY_POLICY.maxAttempts, 1),
    20
  );
  const priority = Math.min(Math.max(input.priority ?? 5, 0), 9);
  const id = intentId(deliveryKey);

  try {
    await store.notification.create({
      data: {
        id,
        incidentId: input.incidentId,
        userId: input.userId,
        channel: input.channel,
        status: 'PENDING',
        message: input.displayMessage.slice(0, 2_000),
        eventType: input.templateKey,
        category: input.category,
        recipientType: input.recipientType,
        recipientId: input.recipientId || recipientHash,
        recipientDisplay: maskedNotificationRecipient(input.channel, input.recipientAddress),
        recipientHash,
        templateKey: input.templateKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        deliveryKey,
        payloadEncrypted,
        priority,
        scheduledAt,
        nextAttemptAt: scheduledAt,
        maxAttempts,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });
    return { id, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await store.notification.findUnique({
      where: { deliveryKey },
      select: { id: true },
    });
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }
}

export async function enqueueCentralNotification(
  input: CentralNotificationInput,
  options: { dispatchImmediately?: boolean } = {}
): Promise<{ id: string; created: boolean; delivered?: boolean; error?: string }> {
  const intent = await createCentralNotificationIntent(input);
  if (!intent.created || options.dispatchImmediately === false) return intent;
  const result = await deliverCentralNotification(intent.id);
  return { ...intent, delivered: result.success, error: result.error };
}

function payloadProviderKey(payload: CentralNotificationPayload): string {
  if (payload.kind === 'EMAIL' && payload.providerScope?.statusPageId) {
    return `status-page:${payload.providerScope.statusPageId}`;
  }
  if (payload.kind === 'WEBHOOK' || payload.kind === 'STATUS_PAGE_WEBHOOK') {
    try {
      return new URL(payload.url).origin;
    } catch {
      return 'invalid-webhook';
    }
  }
  if (payload.kind === 'SLACK_CHANNEL') return `channel:${payload.channel}`;
  if (payload.kind === 'SLACK_WEBHOOK' && payload.webhookUrl) {
    try {
      return new URL(payload.webhookUrl).origin;
    } catch {
      return 'invalid-slack-webhook';
    }
  }
  return 'default';
}

async function providerAdmission(payload: CentralNotificationPayload) {
  const channel = channelForPayload(payload);
  return acquireProviderAdmission(channel as ProviderAdmissionScope, payloadProviderKey(payload));
}

function providerAdmissionIdentity(payload: CentralNotificationPayload) {
  return {
    scope: channelForPayload(payload) as ProviderAdmissionScope,
    providerKey: payloadProviderKey(payload),
  };
}

async function dispatchPayload(
  payload: CentralNotificationPayload,
  notificationId: string
): Promise<DeliveryResult> {
  switch (payload.kind) {
    case 'EMAIL': {
      const { sendEmail } = await import('./email');
      const config = payload.providerScope?.statusPageId
        ? await import('./notification-providers').then(module =>
            module.getStatusPageEmailConfig(payload.providerScope!.statusPageId)
          )
        : undefined;
      return CircuitBreakers.email().execute(() =>
        sendEmail(
          {
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            idempotencyKey: notificationId,
          },
          config
        )
      );
    }
    case 'SMS': {
      const { sendSMS } = await import('./sms');
      return CircuitBreakers.sms().execute(async () => {
        const result = await sendSMS({ to: payload.to, message: payload.message });
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'WHATSAPP': {
      const { sendWhatsApp } = await import('./whatsapp');
      return CircuitBreakers.whatsapp().execute(async () => {
        const result = await sendWhatsApp(payload.to, payload.message, payload.from);
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'PUSH': {
      const { sendPush } = await import('./push');
      return CircuitBreakers.push().execute(() =>
        sendPush({
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          badge: payload.badge,
          deliveryKey: notificationId,
        })
      );
    }
    case 'SLACK_CHANNEL': {
      const { sendSlackMessageToChannel } = await import('./slack');
      return CircuitBreakers.slack().execute(() =>
        sendSlackMessageToChannel(
          payload.channel,
          payload.incident,
          payload.eventType,
          payload.includeInteractiveButtons ?? true,
          payload.serviceId,
          payload.additionalMessage,
          { maxAttempts: 1 }
        )
      );
    }
    case 'SLACK_WEBHOOK': {
      const { sendSlackNotification } = await import('./slack');
      return CircuitBreakers.slack().execute(() =>
        sendSlackNotification(
          payload.eventType,
          payload.incident,
          payload.additionalMessage,
          payload.webhookUrl,
          { maxAttempts: 1 }
        )
      );
    }
    case 'WEBHOOK': {
      const { sendWebhook } = await import('./webhooks');
      return CircuitBreakers.webhook(payload.url).execute(() =>
        sendWebhook({
          url: payload.url,
          payload: payload.payload,
          headers: payload.headers,
          secret: payload.secret,
          method: payload.method,
          timeout: payload.timeout,
          maxAttempts: 1,
        })
      );
    }
    case 'STATUS_PAGE_WEBHOOK': {
      const { deliverWebhook } = await import('./status-page-webhooks');
      const result = await CircuitBreakers.webhook(payload.url).execute(() =>
        deliverWebhook(payload.url, payload.secret, payload.payload, payload.deliveryId, {
          maxAttempts: 1,
        })
      );
      return result.success
        ? { success: true, providerMessageId: payload.deliveryId }
        : {
            success: false,
            error: result.error || 'Status-page webhook delivery failed',
            statusCode: result.statusCode,
            retryAfterMs: result.retryAfterMs,
          };
    }
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function terminalPayload(category: NotificationCategory): { payloadEncrypted: null } | object {
  return category === 'SECURITY' ? { payloadEncrypted: null } : {};
}

async function cleanupExpiredSecurityNotifications(now: Date): Promise<number> {
  const expired = await prisma.notification.findMany({
    where: {
      category: 'SECURITY',
      payloadEncrypted: { not: null },
      expiresAt: { lte: now },
      status: { in: ['PENDING', 'FAILED'] },
    },
    orderBy: { expiresAt: 'asc' },
    take: SECURITY_PAYLOAD_CLEANUP_BATCH_SIZE,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const result = await prisma.notification.updateMany({
    where: { id: { in: expired.map(item => item.id) } },
    data: {
      status: 'SKIPPED',
      payloadEncrypted: null,
      lastAttemptAt: null,
      errorMsg: 'Security notification expired before delivery.',
    },
  });
  return result.count;
}

function isPermanentProviderError(message: string): boolean {
  return /not configured|no (?:enabled email|SMS) provider configured|no Slack webhook URL configured|notifications? (?:are )?(?:disabled|not enabled)|package not installed|configuration incomplete|unsupported provider|unknown provider|invalid phone number format|phone number .* not verified|phone number must include an international country code|no (?:phone number|device|web subscription)|official Slack host|webhook URL is required|invalid or restricted Webhook URL/i.test(
    message
  );
}

async function finishAttempt(input: {
  notificationId: string;
  ordinal: number;
  outcome: string;
  startedAt: Date;
  providerMessageId?: string;
  errorMessage?: string;
}) {
  const finishedAt = new Date();
  await prisma.notificationDeliveryAttempt.create({
    data: {
      notificationId: input.notificationId,
      ordinal: input.ordinal,
      outcome: input.outcome,
      providerMessageId: input.providerMessageId,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt,
      finishedAt,
      latencyMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
    },
  });
}

export async function deliverCentralNotification(
  notificationId: string
): Promise<{ success: boolean; claimed: boolean; error?: string }> {
  const now = new Date();
  const candidate = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      status: true,
      category: true,
      attempts: true,
      maxAttempts: true,
      nextAttemptAt: true,
      scheduledAt: true,
      lastAttemptAt: true,
      expiresAt: true,
      payloadEncrypted: true,
    },
  });
  if (!candidate || !candidate.payloadEncrypted) {
    return { success: false, claimed: false, error: 'Central notification not found' };
  }
  if (candidate.status !== 'PENDING' && candidate.status !== 'FAILED') {
    return { success: false, claimed: false };
  }
  if (candidate.expiresAt && candidate.expiresAt <= now) {
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'SKIPPED',
        errorMsg: 'Notification expired before delivery.',
        ...terminalPayload(candidate.category),
      },
    });
    return { success: true, claimed: true };
  }
  if (
    candidate.attempts >= candidate.maxAttempts ||
    candidate.scheduledAt > now ||
    candidate.nextAttemptAt > now
  ) {
    return { success: false, claimed: false };
  }
  const staleClaimBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const claim = await prisma.notification.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attempts: candidate.attempts,
      scheduledAt: { lte: now },
      nextAttemptAt: { lte: now },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: staleClaimBefore } }],
    },
    data: { status: 'PENDING', lastAttemptAt: now, errorMsg: null },
  });
  if (claim.count === 0) return { success: false, claimed: false };

  if (!candidate.payloadEncrypted) {
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'FAILED',
        attempts: candidate.maxAttempts,
        failedAt: new Date(),
        errorMsg: 'Encrypted delivery payload is missing.',
      },
    });
    return { success: false, claimed: true, error: 'Encrypted delivery payload is missing' };
  }

  let payload: CentralNotificationPayload;
  try {
    const decoded: unknown = JSON.parse(await decrypt(candidate.payloadEncrypted));
    if (!isCentralNotificationPayload(decoded)) throw new Error('Unknown notification payload');
    payload = decoded;
  } catch (error) {
    const errorMessage = safeError(error);
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'FAILED',
        attempts: candidate.maxAttempts,
        failedAt: new Date(),
        errorMsg: `Unable to decrypt delivery payload: ${errorMessage}`,
      },
    });
    return { success: false, claimed: true, error: errorMessage };
  }

  const admission = await providerAdmission(payload);
  if (!admission.allowed) {
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'PENDING',
        failedAt: null,
        lastAttemptAt: null,
        nextAttemptAt: admission.retryAt,
        errorMsg: `Provider admission deferred until ${admission.retryAt.toISOString()}`,
      },
    });
    return { success: false, claimed: true };
  }

  const ordinal = candidate.attempts + 1;
  const attemptClaim = await prisma.notification.updateMany({
    where: {
      id: candidate.id,
      status: 'PENDING',
      lastAttemptAt: now,
      attempts: candidate.attempts,
    },
    data: { attempts: { increment: 1 } },
  });
  if (attemptClaim.count === 0) return { success: false, claimed: false };
  const startedAt = new Date();

  try {
    const result = await dispatchPayload(payload, candidate.id);
    if (result.success) {
      const committed = await prisma.notification.updateMany({
        where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          failedAt: null,
          errorMsg: null,
          providerMessageId: result.providerMessageId,
          ...terminalPayload(candidate.category),
        },
      });
      await finishAttempt({
        notificationId: candidate.id,
        ordinal,
        outcome: committed.count > 0 ? 'ACCEPTED' : 'SUPERSEDED',
        startedAt,
        providerMessageId: result.providerMessageId,
      });
      return { success: true, claimed: true };
    }

    const errorMessage = safeError(result.error || 'Provider delivery failed');
    const providerRateLimited = result.statusCode === 429;
    const providerRetryAt = providerRateLimited
      ? new Date(Date.now() + Math.max(result.retryAfterMs ?? 60_000, 1_000))
      : null;
    if (providerRetryAt) {
      const identity = providerAdmissionIdentity(payload);
      await deferProviderAdmission(identity.scope, identity.providerKey, providerRetryAt);
      await prisma.notification.updateMany({
        where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
        data: {
          status: 'PENDING',
          attempts: candidate.attempts,
          failedAt: null,
          lastAttemptAt: null,
          nextAttemptAt: providerRetryAt,
          errorMsg: `Provider rate-limited delivery until ${providerRetryAt.toISOString()}`,
        },
      });
      return { success: false, claimed: true, error: errorMessage };
    }
    const permanent = isPermanentProviderError(errorMessage);
    const exhausted = ordinal >= candidate.maxAttempts;
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMessage,
        nextAttemptAt:
          providerRetryAt ??
          (permanent || exhausted
            ? candidate.nextAttemptAt
            : new Date(Date.now() + notificationRetryDelayMs(ordinal))),
        attempts: permanent ? candidate.maxAttempts : ordinal,
        lastAttemptAt: null,
        ...(permanent || exhausted ? terminalPayload(candidate.category) : {}),
      },
    });
    await finishAttempt({
      notificationId: candidate.id,
      ordinal,
      outcome: permanent || exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      startedAt,
      errorMessage,
    });
    return { success: false, claimed: true, error: errorMessage };
  } catch (error) {
    const circuitOpen = error instanceof CircuitBreakerError;
    const errorMessage = safeError(error);
    const exhausted = ordinal >= candidate.maxAttempts;
    if (circuitOpen) {
      const retryAt = new Date(Date.now() + notificationRetryDelayMs(Math.max(1, ordinal)));
      await prisma.notification.updateMany({
        where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
        data: {
          status: 'PENDING',
          attempts: candidate.attempts,
          failedAt: null,
          errorMsg: errorMessage,
          nextAttemptAt: retryAt,
          lastAttemptAt: null,
        },
      });
      return { success: false, claimed: true, error: errorMessage };
    }
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMessage,
        nextAttemptAt: exhausted
          ? candidate.nextAttemptAt
          : new Date(Date.now() + notificationRetryDelayMs(ordinal)),
        attempts: ordinal,
        lastAttemptAt: null,
        ...(exhausted ? terminalPayload(candidate.category) : {}),
      },
    });
    await finishAttempt({
      notificationId: candidate.id,
      ordinal,
      outcome: exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      startedAt,
      errorMessage,
    });
    return { success: false, claimed: true, error: errorMessage };
  }
}

export async function processCentralNotificationQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = new Date();
  await cleanupExpiredSecurityNotifications(now);
  const staleClaimBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Notification"
    WHERE "payloadEncrypted" IS NOT NULL
      AND "attempts" < "maxAttempts"
      AND "scheduledAt" <= ${now}
      AND "nextAttemptAt" <= ${now}
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      AND (
        "status" = 'FAILED'::"NotificationStatus"
        OR (
          "status" = 'PENDING'::"NotificationStatus"
          AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" < ${staleClaimBefore})
        )
      )
    ORDER BY "priority" ASC, "nextAttemptAt" ASC, "createdAt" ASC
    LIMIT ${SYSTEM_NOTIFICATION_BATCH_SIZE}
  `);

  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < candidates.length; index += SYSTEM_NOTIFICATION_CONCURRENCY) {
    const batch = candidates.slice(index, index + SYSTEM_NOTIFICATION_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(item => deliverCentralNotification(item.id))
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.claimed && result.value.success)
        succeeded++;
      else if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && result.value.claimed)
      )
        failed++;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}

/** Earliest durable control-plane deadline used by the adaptive scheduler. */
export async function getNextCentralNotificationAt(now: Date = new Date()): Promise<Date | null> {
  const expiredSecurityNotification = await prisma.notification.findFirst({
    where: {
      category: 'SECURITY',
      payloadEncrypted: { not: null },
      expiresAt: { lte: now },
      status: { in: ['PENDING', 'FAILED'] },
    },
    select: { id: true },
  });
  if (expiredSecurityNotification) return now;

  const rows = await prisma.$queryRaw<Array<{ nextEligibleAt: Date }>>(Prisma.sql`
    SELECT GREATEST(
      "scheduledAt",
      "nextAttemptAt",
      CASE
        WHEN "status" = 'PENDING'::"NotificationStatus" AND "lastAttemptAt" IS NOT NULL
          THEN "lastAttemptAt" + (${CLAIM_TIMEOUT_MS} * INTERVAL '1 millisecond')
        ELSE "nextAttemptAt"
      END
    ) AS "nextEligibleAt"
    FROM "Notification"
    WHERE "payloadEncrypted" IS NOT NULL
      AND "attempts" < "maxAttempts"
      AND "status" IN ('PENDING'::"NotificationStatus", 'FAILED'::"NotificationStatus")
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
    ORDER BY "nextEligibleAt" ASC
    LIMIT 1
  `);
  return rows[0]?.nextEligibleAt ?? null;
}

export async function requeueCentralNotification(notificationId: string): Promise<boolean> {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      payloadEncrypted: { not: null },
      status: 'FAILED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { attempts: true, maxAttempts: true },
  });
  if (!notification || notification.attempts >= 20) return false;
  const maxAttempts = Math.min(20, Math.max(notification.maxAttempts, notification.attempts + 1));
  const updated = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      payloadEncrypted: { not: null },
      status: 'FAILED',
      attempts: notification.attempts,
      maxAttempts: notification.maxAttempts,
    },
    data: {
      status: 'PENDING',
      maxAttempts,
      failedAt: null,
      errorMsg: null,
      lastAttemptAt: null,
      nextAttemptAt: new Date(),
    },
  });
  return updated.count > 0;
}

export async function cancelCentralNotification(
  notificationId: string,
  reason: string
): Promise<boolean> {
  const updated = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      payloadEncrypted: { not: null },
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'SKIPPED',
      errorMsg: reason.slice(0, MAX_ERROR_LENGTH),
      lastAttemptAt: null,
      payloadEncrypted: null,
    },
  });
  return updated.count > 0;
}

export const CENTRAL_NOTIFICATION_LIMITS = Object.freeze({
  batchSize: SYSTEM_NOTIFICATION_BATCH_SIZE,
  concurrency: SYSTEM_NOTIFICATION_CONCURRENCY,
  claimTimeoutMs: CLAIM_TIMEOUT_MS,
});
