import { getAppUrl } from '@/lib/app-url';
import { logger } from '@/lib/logger';
import { getVoiceConfig, type VoiceConfig } from '@/lib/notification-providers';
import { createVoiceCallbackToken } from './token';
import { buildVoiceTwiml } from './twiml';
import type { VoiceCallRequest, VoiceCallResult } from './types';

type TwilioCall = { sid: string; status?: string };
type TwilioClient = { calls: { create: (input: Record<string, unknown>) => Promise<TwilioCall> } };
type TwilioFactory = (accountSid: string, authToken: string) => TwilioClient;

function classifyTwilioError(error: unknown): VoiceCallResult {
  const candidate = error as { message?: string; code?: string | number; status?: number };
  const statusCode = candidate.status;
  const errorCode = candidate.code != null ? String(candidate.code) : undefined;
  const message = candidate.message || 'Twilio voice call failed';
  const permanent =
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    ['20003', '21210', '21211', '21212', '21214', '21606'].includes(errorCode || '');
  return {
    success: false,
    error: message,
    errorCode,
    statusCode,
    retryAfterMs: statusCode === 429 ? 60_000 : undefined,
    retryable: !permanent,
  };
}

/**
 * Send a voice call via Twilio. Accepts an optional pre-loaded config to avoid
 * TOCTOU issues when the caller already resolved provider configuration.
 */
export async function sendVoiceCall(
  request: VoiceCallRequest,
  preloadedConfig?: VoiceConfig
): Promise<VoiceCallResult> {
  const config = preloadedConfig ?? (await getVoiceConfig());
  if (!config.enabled || !config.accountSid || !config.authToken || !config.fromNumber) {
    return { success: false, retryable: false, error: 'Twilio Voice is not configured' };
  }
  try {
    const imported = await import('twilio');
    const factory = (imported.default || imported) as unknown as TwilioFactory;
    const baseUrl = await getAppUrl();
    let gatherUrl: string | undefined;
    if (
      request.requireAck &&
      (request.deliveryAttemptId || (request.incidentId && request.userId))
    ) {
      const token = createVoiceCallbackToken(
        request.deliveryAttemptId
          ? {
              deliveryAttemptId: request.deliveryAttemptId,
              escalationGeneration: request.escalationGeneration ?? 0,
            }
          : {
              notificationId: request.notificationId,
              userId: request.userId,
              incidentId: request.incidentId,
              escalationGeneration: request.escalationGeneration ?? 0,
            }
      );
      gatherUrl = `${baseUrl}/api/webhooks/notifications/twilio/voice/gather?token=${encodeURIComponent(token)}`;
    }
    const statusParams = new URLSearchParams({
      notificationId: request.notificationId,
    });
    if (request.deliveryAttemptId) {
      statusParams.set('attemptId', request.deliveryAttemptId);
    }
    const call = await factory(config.accountSid, config.authToken).calls.create({
      to: request.to,
      from: request.from,
      twiml: buildVoiceTwiml({
        message: request.message,
        gatherUrl,
        requireAck: Boolean(gatherUrl),
      }),
      statusCallback: `${baseUrl}/api/webhooks/notifications/twilio/voice/status?${statusParams.toString()}`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      timeout: 20,
    });
    return {
      success: true,
      callSid: call.sid,
      providerMessageId: call.sid,
      status: call.status,
    };
  } catch (error) {
    logger.error('voice.twilio_create_failed', {
      notificationId: request.notificationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return classifyTwilioError(error);
  }
}
