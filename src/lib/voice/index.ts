import prisma from '@/lib/prisma';
import { buildIncidentVoiceMessage } from './message';
import { sendVoiceCall } from './twilio';
import type { VoiceCallResult } from './types';

export async function sendIncidentVoice(
  userId: string,
  incidentId: string,
  notificationId: string,
  durableMessage: string,
  escalationGeneration?: number
): Promise<VoiceCallResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneNumber: true },
  });
  if (!user?.phoneNumber) {
    return { success: false, retryable: false, error: 'User has no phone number' };
  }
  const config = await import('@/lib/notification-providers').then(module =>
    module.getVoiceConfig()
  );
  if (!config.fromNumber) {
    return {
      success: false,
      retryable: false,
      error: 'Twilio Voice From number is not configured',
    };
  }
  return sendVoiceCall({
    to: user.phoneNumber,
    from: config.fromNumber,
    message: buildIncidentVoiceMessage(durableMessage),
    notificationId,
    incidentId,
    userId,
    escalationGeneration,
    requireAck: true,
  });
}

export async function sendTestVoice(
  to: string,
  notificationId: string,
  message: string
): Promise<VoiceCallResult> {
  const config = await import('@/lib/notification-providers').then(module =>
    module.getVoiceConfig()
  );
  if (!config.fromNumber) {
    return {
      success: false,
      retryable: false,
      error: 'Twilio Voice From number is not configured',
    };
  }
  return sendVoiceCall({ to, from: config.fromNumber, message, notificationId, requireAck: false });
}
