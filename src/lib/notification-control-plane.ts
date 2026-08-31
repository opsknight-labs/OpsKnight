import 'server-only';

import crypto from 'crypto';
import {
  Prisma,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationRecipientType,
} from '@prisma/client';
import prisma from './prisma';
import {
  CircuitBreakerError,
  CircuitBreakerTimeoutError,
  CircuitBreakers,
  type CircuitBreaker,
} from './circuit-breaker';
import { decrypt, encrypt, getEncryptionKey } from './encryption';
import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  deferProviderAdmission,
  releaseProviderConcurrency,
  type ProviderAdmissionScope,
} from './provider-admission';
import { notificationRetryDelayMs, NOTIFICATION_RETRY_POLICY } from './notification-delivery';
import { logger } from './logger';

const MAX_ENCRYPTED_PAYLOAD_BYTES = 768 * 1024;
const MAX_ERROR_LENGTH = 1_000;
// This lease exceeds every adapter timeout. Reclaiming an active provider call can
// produce a duplicate on channels that do not support provider-side idempotency.
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const SYSTEM_NOTIFICATION_BATCH_SIZE = 100;
const SYSTEM_NOTIFICATION_CONCURRENCY = 10;
const EXPIRED_NOTIFICATION_CLEANUP_BATCH_SIZE = 100;

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
      kind: 'INCIDENT_EMAIL' | 'INCIDENT_SMS' | 'INCIDENT_PUSH' | 'INCIDENT_WHATSAPP';
      userId: string;
      incidentId: string;
      eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated';
      eventAt: string;
      escalationGeneration?: number;
      escalationStep?: number;
      durableMessage: string;
      providerKey?: string;
    }
  | {
      kind: 'EMAIL';
      to: string;
      subject: string;
      html: string;
      text?: string;
      providerScope?: {
        statusPageId: string;
        subscriptionId?: string;
        incidentId?: string;
        eventType?: 'triggered' | 'acknowledged' | 'resolved' | 'updated';
      };
      providerKey?: string;
    }
  | { kind: 'SMS'; to: string; message: string; providerKey?: string }
  | { kind: 'WHATSAPP'; to: string; message: string; from?: string; providerKey?: string }
  | {
      kind: 'PUSH';
      userId: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      badge?: number;
      providerKey?: string;
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
      lifecyclePolicy?: {
        incidentId: string;
        eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated';
      };
    }
  | {
      kind: 'STATUS_PAGE_WEBHOOK';
      url: string;
      secret: string;
      payload: { event: string; timestamp: string; data: unknown };
      deliveryId: string;
      webhookId: string;
      statusPageId?: string;
      incidentId?: string;
      serviceId?: string;
    };

type IncidentCentralPayload = Extract<
  CentralNotificationPayload,
  { kind: 'INCIDENT_EMAIL' | 'INCIDENT_SMS' | 'INCIDENT_PUSH' | 'INCIDENT_WHATSAPP' }
>;

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
  skipped?: boolean;
  error?: string;
  providerMessageId?: string;
  statusCode?: number;
  retryAfterMs?: number;
  errorCode?: string;
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
  const key = process.env.NEXTAUTH_SECRET?.trim() || getEncryptionKey();
  if (!key) throw new Error('Notification encryption is not configured');
  const keyBytes = /^[a-f0-9]{64}$/i.test(key)
    ? Buffer.from(key, 'hex')
    : crypto.createHash('sha256').update(key).digest();
  return crypto
    .createHmac('sha256', keyBytes)
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
  if (payload.kind === 'INCIDENT_EMAIL') return 'EMAIL';
  if (payload.kind === 'INCIDENT_SMS') return 'SMS';
  if (payload.kind === 'INCIDENT_PUSH') return 'PUSH';
  if (payload.kind === 'INCIDENT_WHATSAPP') return 'WHATSAPP';
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
    case 'INCIDENT_EMAIL':
    case 'INCIDENT_SMS':
    case 'INCIDENT_PUSH':
    case 'INCIDENT_WHATSAPP':
      return (
        hasText(value.userId) &&
        hasText(value.incidentId) &&
        hasText(value.eventType) &&
        hasText(value.eventAt) &&
        hasText(value.durableMessage)
      );
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
        hasText(value.webhookId) &&
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
  if (!hasText(input.recipientAddress)) {
    throw new Error('Notification recipient is required');
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
  let pinnedInput = input;
  if (
    (input.payload.kind === 'EMAIL' || input.payload.kind === 'INCIDENT_EMAIL') &&
    !input.payload.providerKey
  ) {
    const emailPayload = input.payload;
    const providerKey =
      emailPayload.kind === 'EMAIL' && emailPayload.providerScope?.statusPageId
        ? await import('./notification-providers')
            .then(module =>
              module.getStatusPageEmailConfig(emailPayload.providerScope!.statusPageId)
            )
            .then(config => config.provider || undefined)
        : await import('./notification-providers')
            .then(module => module.getAllConfiguredEmailProviders())
            .then(
              configs =>
                configs.find(config => config.enabled && config.provider)?.provider || undefined
            );
    if (providerKey) pinnedInput = { ...input, payload: { ...input.payload, providerKey } };
  } else if (
    (input.payload.kind === 'SMS' || input.payload.kind === 'INCIDENT_SMS') &&
    !input.payload.providerKey
  ) {
    const providerKey = await import('./notification-providers').then(module =>
      module.getSMSConfig().then(config => config.provider || undefined)
    );
    if (providerKey) pinnedInput = { ...input, payload: { ...input.payload, providerKey } };
  } else if (
    (input.payload.kind === 'WHATSAPP' || input.payload.kind === 'INCIDENT_WHATSAPP') &&
    !input.payload.providerKey
  ) {
    const providerKey = await import('./notification-providers').then(module =>
      module.getWhatsAppConfig().then(config => config.provider || undefined)
    );
    if (providerKey) pinnedInput = { ...input, payload: { ...input.payload, providerKey } };
  } else if (
    (input.payload.kind === 'PUSH' || input.payload.kind === 'INCIDENT_PUSH') &&
    !input.payload.providerKey
  ) {
    const providerKey = await import('./notification-providers').then(module =>
      module.getPushConfig().then(config => config.provider || undefined)
    );
    if (providerKey) pinnedInput = { ...input, payload: { ...input.payload, providerKey } };
  }
  const intent = await createCentralNotificationIntent(pinnedInput);
  if (!intent.created || options.dispatchImmediately === false) return intent;
  const result = await deliverCentralNotification(intent.id);
  return { ...intent, delivered: result.success, error: result.error };
}

function payloadProviderKey(payload: CentralNotificationPayload): string {
  if (payload.kind === 'WEBHOOK' || payload.kind === 'STATUS_PAGE_WEBHOOK') {
    try {
      return new URL(payload.url).origin;
    } catch {
      return 'invalid-webhook';
    }
  }
  if ('providerKey' in payload && payload.providerKey) return payload.providerKey;
  // Provider budgets are account-wide. A conservative shared key prevents
  // tenant/page/channel partitions from multiplying the upstream allowance.
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

/** Only upstream 5xx responses poison shared provider health. */
function executeProvider<T extends DeliveryResult>(
  breaker: CircuitBreaker,
  operation: () => Promise<T>
): Promise<T> {
  return breaker.execute(operation, {
    shouldCountFailure: (result: T) => result.success === false && (result.statusCode ?? 0) >= 500,
  });
}

async function dispatchPayload(
  payload: CentralNotificationPayload,
  notificationId: string
): Promise<DeliveryResult> {
  switch (payload.kind) {
    case 'INCIDENT_EMAIL': {
      const { sendIncidentEmail } = await import('./email');
      const config = payload.providerKey
        ? await import('./notification-providers')
            .then(module => module.getAllConfiguredEmailProviders())
            .then(configs => configs.find(item => item.provider === payload.providerKey))
        : undefined;
      if (payload.providerKey && !config)
        return {
          success: false,
          statusCode: 409,
          errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
          error: `Pinned Email provider ${payload.providerKey} is unavailable`,
        };
      return executeProvider(CircuitBreakers.email(), () =>
        sendIncidentEmail(
          payload.userId,
          payload.incidentId,
          payload.eventType,
          notificationId,
          payload.durableMessage,
          config
        )
      );
    }
    case 'INCIDENT_SMS': {
      const { sendIncidentSMS } = await import('./sms');
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getSMSConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned SMS provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.sms(), async () => {
        const result = await sendIncidentSMS(
          payload.userId,
          payload.incidentId,
          payload.eventType,
          notificationId,
          payload.durableMessage
        );
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'INCIDENT_PUSH': {
      const { sendNotificationIntentPush } = await import('./incident-push-delivery');
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getPushConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned Push provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.push(), async () => {
        const result = await sendNotificationIntentPush(
          payload.userId,
          payload.incidentId,
          payload.eventType,
          payload.durableMessage,
          notificationId
        );
        return result.code === 'NO_DEVICE_TOKENS' || result.code === 'NO_WEB_SUBSCRIPTIONS'
          ? { ...result, success: true, skipped: true }
          : result;
      });
    }
    case 'INCIDENT_WHATSAPP': {
      const { sendIncidentWhatsApp } = await import('./whatsapp');
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getWhatsAppConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned WhatsApp provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.whatsapp(), async () => {
        const result = await sendIncidentWhatsApp(
          payload.userId,
          payload.incidentId,
          payload.eventType,
          notificationId,
          payload.durableMessage
        );
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'EMAIL': {
      const { sendEmail } = await import('./email');
      const config = payload.providerScope?.statusPageId
        ? await import('./notification-providers').then(module =>
            module.getStatusPageEmailConfig(payload.providerScope!.statusPageId)
          )
        : payload.providerKey
          ? await import('./notification-providers')
              .then(module => module.getAllConfiguredEmailProviders())
              .then(configs => configs.find(item => item.provider === payload.providerKey))
          : undefined;
      if (payload.providerKey && (!config || config.provider !== payload.providerKey))
        return {
          success: false,
          statusCode: 409,
          errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
          error: `Pinned Email provider ${payload.providerKey} is unavailable`,
        };
      return executeProvider(CircuitBreakers.email(), () =>
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
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getSMSConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned SMS provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.sms(), async () => {
        const result = await sendSMS({
          to: payload.to,
          message: payload.message,
          notificationId,
        });
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'WHATSAPP': {
      const { sendWhatsApp } = await import('./whatsapp');
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getWhatsAppConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned WhatsApp provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.whatsapp(), async () => {
        const result = await sendWhatsApp(
          payload.to,
          payload.message,
          payload.from,
          notificationId
        );
        return { ...result, providerMessageId: result.messageSid };
      });
    }
    case 'PUSH': {
      const { sendPush } = await import('./push');
      if (payload.providerKey) {
        const current = await import('./notification-providers').then(module =>
          module.getPushConfig()
        );
        if (current.provider !== payload.providerKey)
          return {
            success: false,
            statusCode: 409,
            errorCode: 'PINNED_PROVIDER_UNAVAILABLE',
            error: `Pinned Push provider ${payload.providerKey} is unavailable`,
          };
      }
      return executeProvider(CircuitBreakers.push(), () =>
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
      return executeProvider(CircuitBreakers.slack(), () =>
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
      return executeProvider(CircuitBreakers.slack(), () =>
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
      return executeProvider(CircuitBreakers.webhook(payload.url), () =>
        sendWebhook({
          url: payload.url,
          payload: payload.payload,
          headers: payload.headers,
          secret: payload.secret,
          method: payload.method,
          timeout: payload.timeout,
          maxAttempts: 1,
          circuitBreaker: false,
        })
      );
    }
    case 'STATUS_PAGE_WEBHOOK': {
      const { deliverWebhook } = await import('./status-page-webhooks');
      const result = await executeProvider(CircuitBreakers.webhook(payload.url), () =>
        deliverWebhook(payload.url, payload.secret, payload.payload, payload.deliveryId, {
          maxAttempts: 1,
          webhookId: payload.webhookId,
          circuitBreaker: false,
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

function terminalPayload(_category: NotificationCategory): { payloadEncrypted: null } {
  return { payloadEncrypted: null };
}

async function cleanupExpiredNotifications(now: Date): Promise<number> {
  const staleClaimBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const expired = await prisma.notification.findMany({
    where: {
      payloadEncrypted: { not: null },
      expiresAt: { lte: now },
      status: { in: ['PENDING', 'FAILED'] },
      OR: [
        { status: 'FAILED' },
        { status: 'PENDING', lastAttemptAt: null },
        { status: 'PENDING', lastAttemptAt: { lt: staleClaimBefore } },
      ],
    },
    orderBy: { expiresAt: 'asc' },
    take: EXPIRED_NOTIFICATION_CLEANUP_BATCH_SIZE,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const result = await prisma.notification.updateMany({
    where: { id: { in: expired.map(item => item.id) } },
    data: {
      status: 'SKIPPED',
      payloadEncrypted: null,
      lastAttemptAt: null,
      errorMsg: 'Notification expired before delivery.',
    },
  });
  return result.count;
}

function isPermanentProviderError(message: string): boolean {
  return /not configured|no (?:enabled email|SMS) provider configured|no Slack webhook URL configured|notifications? (?:are )?(?:disabled|not enabled)|package not installed|configuration incomplete|unsupported provider|unknown provider|invalid phone number format|phone number .* not verified|phone number must include an international country code|no (?:phone number|device|web subscription)|official Slack host|webhook URL is required|invalid or restricted Webhook URL|message_limit_exceeded/i.test(
    message
  );
}

async function incidentPayloadSuperseded(
  payload: CentralNotificationPayload
): Promise<string | null> {
  if (
    payload.kind !== 'INCIDENT_EMAIL' &&
    payload.kind !== 'INCIDENT_SMS' &&
    payload.kind !== 'INCIDENT_PUSH' &&
    payload.kind !== 'INCIDENT_WHATSAPP'
  ) {
    return null;
  }
  const incidentPayload: IncidentCentralPayload = payload;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentPayload.incidentId },
    select: {
      status: true,
      updatedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      currentEscalationStep: true,
      escalationGeneration: true,
    },
  });
  if (!incident) return 'Incident no longer exists';
  const expectedAt = new Date(incidentPayload.eventAt).getTime();
  if (!Number.isFinite(expectedAt)) return 'Incident notification has an invalid event instant';
  if (incidentPayload.eventType === 'triggered') {
    if (incident.status !== 'OPEN') return `Incident is now ${incident.status}`;
    if (
      incidentPayload.escalationGeneration != null &&
      incident.escalationGeneration !== incidentPayload.escalationGeneration
    ) {
      return 'Escalation generation was superseded';
    }
    return null;
  }
  if (incidentPayload.eventType === 'acknowledged') {
    return incident.status === 'RESOLVED' || incident.acknowledgedAt?.getTime() !== expectedAt
      ? 'Acknowledgement generation was superseded'
      : null;
  }
  if (incidentPayload.eventType === 'resolved') {
    return incident.status !== 'RESOLVED' || incident.resolvedAt?.getTime() !== expectedAt
      ? 'Resolution generation was superseded'
      : null;
  }
  // The durable event key identifies an update. ORM updatedAt also changes for
  // internal bookkeeping and must never invalidate that committed event.
  return incident.status === 'RESOLVED' ? 'Incident update was superseded by resolution' : null;
}

function lifecycleStatusRevocation(
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  status: string
): string | null {
  if (eventType === 'triggered' && status !== 'OPEN')
    return `Triggered event was superseded by ${status}`;
  if (eventType === 'acknowledged' && status === 'RESOLVED')
    return 'Acknowledgement was superseded by resolution';
  if (eventType === 'updated' && status === 'RESOLVED')
    return 'Update was superseded by resolution';
  if (eventType === 'resolved' && status !== 'RESOLVED') return 'Resolution is no longer current';
  return null;
}

async function lifecycleDeliveryRevoked(
  payload: CentralNotificationPayload
): Promise<string | null> {
  const policy =
    payload.kind === 'SLACK_CHANNEL' || payload.kind === 'SLACK_WEBHOOK'
      ? { incidentId: payload.incident.id, eventType: payload.eventType }
      : payload.kind === 'WEBHOOK'
        ? payload.lifecyclePolicy
        : null;
  if (!policy) return null;
  const incident = await prisma.incident.findUnique({
    where: { id: policy.incidentId },
    select: { status: true },
  });
  if (!incident) return 'Incident no longer exists';
  return lifecycleStatusRevocation(policy.eventType, incident.status);
}

async function statusSubscriberDeliveryRevoked(
  payload: CentralNotificationPayload
): Promise<string | null> {
  if (
    payload.kind !== 'EMAIL' ||
    !payload.providerScope?.subscriptionId ||
    !payload.providerScope.incidentId
  )
    return null;
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: payload.providerScope.incidentId },
      select: { visibility: true, serviceId: true, status: true },
    });
    if (!incident || incident.visibility !== 'PUBLIC')
      return 'Status-page incident is no longer public';
    if (payload.providerScope.eventType) {
      const stale = lifecycleStatusRevocation(payload.providerScope.eventType, incident.status);
      if (stale) return stale;
    }
    const page = await prisma.statusPage.findFirst({
      where: {
        id: payload.providerScope.statusPageId,
        enabled: true,
        showIncidents: true,
        services: { some: { serviceId: incident.serviceId, showOnPage: true } },
        subscriptions: {
          some: { id: payload.providerScope.subscriptionId, verified: true, unsubscribedAt: null },
        },
      },
      select: { id: true },
    });
    return page ? null : 'Status-page subscription or visibility was revoked';
  } catch {
    return 'Status-page delivery policy could not be revalidated';
  }
}

async function statusWebhookDeliveryRevoked(
  payload: CentralNotificationPayload
): Promise<string | null> {
  if (payload.kind !== 'STATUS_PAGE_WEBHOOK' || !payload.statusPageId) return null;
  try {
    if (payload.incidentId) {
      const incident = await prisma.incident.findUnique({
        where: { id: payload.incidentId },
        select: { visibility: true, serviceId: true, status: true },
      });
      if (!incident || incident.visibility !== 'PUBLIC')
        return 'Status-page incident is no longer public';
      if (payload.serviceId && incident.serviceId !== payload.serviceId)
        return 'Incident service mapping changed';
      const eventType = payload.payload.event as
        | 'triggered'
        | 'acknowledged'
        | 'resolved'
        | 'updated';
      const stale = lifecycleStatusRevocation(eventType, incident.status);
      if (stale) return stale;
    }
    const webhook = await prisma.statusPageWebhook.findFirst({
      where: {
        id: payload.webhookId,
        statusPageId: payload.statusPageId,
        enabled: true,
        events: { array_contains: payload.payload.event },
        statusPage: {
          enabled: true,
          showIncidents: payload.incidentId ? true : undefined,
          services: payload.serviceId
            ? { some: { serviceId: payload.serviceId, showOnPage: true } }
            : undefined,
        },
      },
      select: { id: true },
    });
    return webhook ? null : 'Status-page webhook was revoked or disabled';
  } catch {
    return 'Status-page webhook policy could not be revalidated';
  }
}

async function finishAttempt(input: {
  notificationId: string;
  ordinal: number;
  outcome: string;
  startedAt: Date;
  providerMessageId?: string;
  provider?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  const finishedAt = new Date();
  try {
    await prisma.notificationDeliveryAttempt.create({
      data: {
        notificationId: input.notificationId,
        ordinal: input.ordinal,
        outcome: input.outcome,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        startedAt: input.startedAt,
        finishedAt,
        latencyMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
      },
    });
  } catch (error) {
    logger.error('notification.attempt_ledger_write_failed', {
      notificationId: input.notificationId,
      ordinal: input.ordinal,
      outcome: input.outcome,
      error: safeError(error),
    });
  }
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

  const supersededReason =
    (await statusSubscriberDeliveryRevoked(payload)) ??
    (await statusWebhookDeliveryRevoked(payload)) ??
    (await lifecycleDeliveryRevoked(payload)) ??
    (await incidentPayloadSuperseded(payload));
  if (supersededReason) {
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'SKIPPED',
        lastAttemptAt: null,
        errorMsg: supersededReason,
        ...terminalPayload(candidate.category),
      },
    });
    return { success: true, claimed: true };
  }

  let admission;
  try {
    admission = await providerAdmission(payload);
  } catch (error) {
    const errorMessage = safeError(error);
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'PENDING',
        failedAt: null,
        lastAttemptAt: null,
        nextAttemptAt: new Date(Date.now() + notificationRetryDelayMs(1)),
        errorMsg: `Provider admission unavailable: ${errorMessage}`,
      },
    });
    return { success: false, claimed: true, error: errorMessage };
  }
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

  const identity = providerAdmissionIdentity(payload);
  let concurrency;
  try {
    concurrency = await acquireProviderConcurrency(identity.scope, identity.providerKey, now);
  } catch (error) {
    const errorMessage = safeError(error);
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'PENDING',
        lastAttemptAt: null,
        nextAttemptAt: new Date(Date.now() + notificationRetryDelayMs(1)),
        errorMsg: `Provider concurrency admission unavailable: ${errorMessage}`,
      },
    });
    return { success: false, claimed: true, error: errorMessage };
  }
  if (!concurrency.allowed) {
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        status: 'PENDING',
        lastAttemptAt: null,
        nextAttemptAt: concurrency.retryAt,
        errorMsg: `Provider concurrency deferred until ${concurrency.retryAt.toISOString()}`,
      },
    });
    return { success: false, claimed: true };
  }

  const deliveryAttempt = candidate.attempts + 1;
  let ordinal: number;
  try {
    ordinal =
      (await prisma.notificationDeliveryAttempt.count({
        where: { notificationId: candidate.id },
      })) + 1;
  } catch (error) {
    await releaseProviderConcurrency(concurrency.leaseKey).catch(() => undefined);
    const errorMessage = safeError(error);
    await prisma.notification.updateMany({
      where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
      data: {
        lastAttemptAt: null,
        nextAttemptAt: new Date(Date.now() + notificationRetryDelayMs(1)),
        errorMsg: `Attempt history unavailable: ${errorMessage}`,
      },
    });
    return { success: false, claimed: true, error: errorMessage };
  }
  const attemptClaim = await prisma.notification.updateMany({
    where: {
      id: candidate.id,
      status: 'PENDING',
      lastAttemptAt: now,
      attempts: candidate.attempts,
    },
    data: { attempts: { increment: 1 } },
  });
  if (attemptClaim.count === 0) {
    await releaseProviderConcurrency(concurrency.leaseKey).catch(() => undefined);
    return { success: false, claimed: false };
  }
  const startedAt = new Date();

  try {
    let result: DeliveryResult;
    let releaseConcurrencyLease = true;
    try {
      result = await dispatchPayload(payload, candidate.id);
    } catch (dispatchError) {
      // A timed-out mutation is still running from the provider client's point
      // of view. Retain the distributed slot until its lease expires.
      if (dispatchError instanceof CircuitBreakerTimeoutError) {
        releaseConcurrencyLease = false;
      }
      throw dispatchError;
    } finally {
      if (releaseConcurrencyLease) {
        await releaseProviderConcurrency(concurrency.leaseKey).catch(() => undefined);
      }
    }
    if (result.success) {
      const finishedAt = new Date();
      const acceptedState = {
        status: result.skipped ? ('SKIPPED' as const) : ('SENT' as const),
        sentAt: result.skipped ? null : finishedAt,
        failedAt: null,
        errorMsg: null,
        providerMessageId: result.providerMessageId,
        ...terminalPayload(candidate.category),
      };
      let committed: { count: number };
      try {
        [committed] = await prisma.$transaction([
          prisma.notification.updateMany({
            where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
            data: acceptedState,
          }),
          prisma.notificationDeliveryAttempt.create({
            data: {
              notificationId: candidate.id,
              ordinal,
              outcome: result.skipped ? 'SKIPPED' : 'ACCEPTED',
              provider: identity.providerKey,
              providerMessageId: result.providerMessageId,
              startedAt,
              finishedAt,
              latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
            },
          }),
        ]);
      } catch (persistenceError) {
        // Provider acceptance is delivery truth. A telemetry-row failure must
        // never turn it into a retry or trigger another channel fallback.
        committed = await prisma.notification.updateMany({
          where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
          data: acceptedState,
        });
        logger.error('notification.attempt_ledger_failed_after_provider_acceptance', {
          notificationId: candidate.id,
          providerMessageId: result.providerMessageId,
          error: safeError(persistenceError),
        });
      }
      if (committed.count === 0) return { success: false, claimed: false };
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
      await finishAttempt({
        notificationId: candidate.id,
        ordinal,
        outcome: 'RATE_LIMITED',
        startedAt,
        provider: identity.providerKey,
        errorCode: result.errorCode ?? (result.statusCode ? String(result.statusCode) : undefined),
        errorMessage,
      });
      return { success: false, claimed: true, error: errorMessage };
    }
    const permanent = isPermanentProviderError(errorMessage);
    const exhausted = deliveryAttempt >= candidate.maxAttempts;
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
            : new Date(Date.now() + notificationRetryDelayMs(deliveryAttempt))),
        attempts: permanent ? candidate.maxAttempts : deliveryAttempt,
        lastAttemptAt: null,
        ...(permanent || exhausted ? terminalPayload(candidate.category) : {}),
      },
    });
    await finishAttempt({
      notificationId: candidate.id,
      ordinal,
      outcome: permanent || exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      startedAt,
      provider: identity.providerKey,
      errorMessage,
      errorCode: result.errorCode,
    });
    return { success: false, claimed: true, error: errorMessage };
  } catch (error) {
    const circuitOpen = error instanceof CircuitBreakerError;
    const ambiguous = error instanceof CircuitBreakerTimeoutError;
    const errorMessage = safeError(error);
    const exhausted = deliveryAttempt >= candidate.maxAttempts;
    if (ambiguous) {
      const ambiguousState = {
        status: 'FAILED' as const,
        attempts: candidate.maxAttempts,
        failedAt: new Date(),
        errorMsg: `Ambiguous provider outcome: ${errorMessage}`,
        lastAttemptAt: null,
        ...terminalPayload(candidate.category),
      };
      try {
        await prisma.$transaction(async tx => {
          await tx.notification.updateMany({
            where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
            data: ambiguousState,
          });
          await tx.notificationDeliveryAttempt.create({
            data: {
              notificationId: candidate.id,
              ordinal,
              outcome: 'AMBIGUOUS',
              provider: identity.providerKey,
              errorMessage,
              startedAt,
              finishedAt: new Date(),
            },
          });
        });
      } catch (persistenceError) {
        await prisma.notification.updateMany({
          where: { id: candidate.id, status: 'PENDING', lastAttemptAt: now },
          data: ambiguousState,
        });
        logger.error('notification.ambiguous_ledger_write_failed', {
          notificationId: candidate.id,
          error: safeError(persistenceError),
        });
      }
      // Suppress synchronous channel fallback: the provider may still accept
      // the mutation after our client-side timeout.
      return { success: true, claimed: true, error: errorMessage };
    }
    if (circuitOpen) {
      const retryAt = new Date(Date.now() + notificationRetryDelayMs(Math.max(1, deliveryAttempt)));
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
          : new Date(Date.now() + notificationRetryDelayMs(deliveryAttempt)),
        attempts: deliveryAttempt,
        lastAttemptAt: null,
        ...(exhausted ? terminalPayload(candidate.category) : {}),
      },
    });
    await finishAttempt({
      notificationId: candidate.id,
      ordinal,
      outcome: exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      startedAt,
      provider: identity.providerKey,
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
  await cleanupExpiredNotifications(now);
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
    -- Age one priority level every five minutes. Critical work wins initially,
    -- while sustained critical traffic cannot starve older normal deliveries.
    ORDER BY GREATEST(
      1,
      "priority" - FLOOR(EXTRACT(EPOCH FROM (${now} - "createdAt")) / 300)
    ) ASC, "nextAttemptAt" ASC, "createdAt" ASC
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
  const staleClaimBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const expiredNotification = await prisma.notification.findFirst({
    where: {
      payloadEncrypted: { not: null },
      expiresAt: { lte: now },
      status: { in: ['PENDING', 'FAILED'] },
      OR: [
        { status: 'FAILED' },
        { status: 'PENDING', lastAttemptAt: null },
        { status: 'PENDING', lastAttemptAt: { lt: staleClaimBefore } },
      ],
    },
    select: { id: true },
  });
  if (expiredNotification) return now;

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
