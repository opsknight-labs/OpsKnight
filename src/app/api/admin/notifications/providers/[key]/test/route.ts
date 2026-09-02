import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { emitAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { decryptProviderConfig } from '@/lib/encrypted-provider-config';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS = [
  'twilio',
  'whatsapp',
  'resend',
  'sendgrid',
  'ses',
  'smtp',
  'web-push',
] as const;

export async function POST(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }

  if (user.role !== 'ADMIN') {
    return jsonError('Administrator access required', 403);
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return jsonError('Invalid request origin', 403);
  }

  const { key } = await context.params;
  const normalizedKey = key.toLowerCase();

  if (!VALID_PROVIDERS.includes(normalizedKey as (typeof VALID_PROVIDERS)[number])) {
    return jsonError(`Invalid or unsupported provider: ${key}`, 400);
  }

  try {
    // 1. Fetch provider record
    const lookupKey = normalizedKey === 'whatsapp' ? 'twilio' : normalizedKey;
    const providerRecord = await prisma.notificationProvider.findUnique({
      where: { provider: lookupKey },
    });

    if (!providerRecord || !providerRecord.enabled) {
      return jsonError(`Provider '${key}' is not configured or enabled.`, 400);
    }

    const decryptedConfig = await decryptProviderConfig(
      lookupKey,
      (providerRecord.config as Record<string, unknown>) || {}
    );

    const eventKey = `test-provider:${normalizedKey}:${crypto.randomUUID()}`;

    // 2. Perform durable test dispatch via central notification control plane
    if (['resend', 'sendgrid', 'ses', 'smtp'].includes(normalizedKey)) {
      if (!user.email) {
        return jsonError(
          'Current admin user has no email address configured to receive the test message.',
          400
        );
      }

      const result = await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.email,
        userId: user.id,
        templateKey: 'provider-test',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey,
        displayMessage: `Provider test via ${normalizedKey.toUpperCase()}`,
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'EMAIL',
          to: user.email,
          subject: `[OpsKnight Test] Outbound Alert via ${normalizedKey.toUpperCase()}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #111;">
              <h2 style="color: #059669; margin-bottom: 8px;">✅ Provider Test Successful</h2>
              <p>This is an automated test notification dispatched from your OpsKnight instance via <strong>${normalizedKey.toUpperCase()}</strong>.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p style="font-size: 12px; color: #6b7280;">Dispatched by: ${user.name || user.email} (${user.role})</p>
              <p style="font-size: 12px; color: #6b7280;">Timestamp: ${new Date().toISOString()}</p>
            </div>
          `,
          text: `[OpsKnight Test] Provider Test Successful. Outbound alert dispatched via ${normalizedKey.toUpperCase()}.`,
          providerKey: normalizedKey,
        },
      });

      if (!result.delivered && result.error) {
        throw new Error(result.error);
      }
    } else if (normalizedKey === 'twilio') {
      const targetPhone =
        user.phoneNumber ||
        (decryptedConfig?.fromNumber as string) ||
        (decryptedConfig?.phoneNumber as string);
      if (!targetPhone) {
        return jsonError(
          'No recipient phone number available. Add a phone number to your profile or configure a test number.',
          400
        );
      }

      const result = await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'SMS',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: targetPhone,
        userId: user.id,
        templateKey: 'provider-test',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey,
        displayMessage: `Provider test via Twilio SMS`,
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'SMS',
          to: targetPhone,
          message: `[OpsKnight] Provider test successful! Twilio SMS is operational. Dispatched: ${new Date().toLocaleTimeString()}`,
          providerKey: 'twilio',
        },
      });

      if (!result.delivered && result.error) {
        throw new Error(result.error);
      }
    } else if (normalizedKey === 'whatsapp') {
      const whatsappEnabled = Boolean(decryptedConfig?.whatsappEnabled);
      if (!whatsappEnabled) {
        return jsonError('WhatsApp messaging is not enabled in the Twilio configuration.', 400);
      }

      const targetPhone = user.phoneNumber || (decryptedConfig?.whatsappNumber as string);
      if (!targetPhone) {
        return jsonError('No WhatsApp phone number configured.', 400);
      }

      const result = await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'WHATSAPP',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: targetPhone,
        userId: user.id,
        templateKey: 'provider-test',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey,
        displayMessage: `Provider test via WhatsApp`,
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'WHATSAPP',
          to: targetPhone,
          message: `[OpsKnight] WhatsApp provider test successful! Dispatched: ${new Date().toLocaleTimeString()}`,
          providerKey: 'whatsapp',
        },
      });

      if (!result.delivered && result.error) {
        throw new Error(result.error);
      }
    } else if (normalizedKey === 'web-push') {
      const result = await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'PUSH',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.id,
        userId: user.id,
        templateKey: 'provider-test',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey,
        displayMessage: `Provider test via Web Push`,
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'PUSH',
          userId: user.id,
          title: '🔔 OpsKnight Provider Test',
          body: 'Web Push (VAPID) provider is active and verified.',
          data: { url: '/settings/notifications', type: 'test' },
          providerKey: 'web-push',
        },
      });

      if (!result.delivered && result.error) {
        if (result.error.includes('No push subscriptions')) {
          logger.info('admin.notifications.test_push.no_devices', { userId: user.id });
        } else {
          throw new Error(result.error);
        }
      }
    }

    // 3. Log audit event
    await emitAuditEvent({
      action: 'NOTIFICATION_PROVIDER_TESTED',
      source: 'UI',
      actor: { type: 'USER', id: user.id, email: user.email, name: user.name },
      target: { type: 'SYSTEM_CONFIG', id: normalizedKey },
      metadata: { provider: normalizedKey },
    });

    return jsonOk(
      { success: true, message: `Test notification sent successfully via ${normalizedKey}` },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (error) {
    logger.error('api.admin.notifications.provider_test.failed', {
      actorId: user.id,
      provider: key,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      error instanceof Error ? error.message : 'Unable to send test notification',
      500
    );
  }
}
