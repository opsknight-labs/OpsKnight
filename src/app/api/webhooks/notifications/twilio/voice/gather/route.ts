import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env-validation';
import { executeIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { readIntegrationBody } from '@/lib/integrations/request-security';
import { logger } from '@/lib/logger';
import { getVoiceConfig } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { validateTwilioRequest } from '@/lib/twilio/signature';
import { verifyVoiceCallbackToken } from '@/lib/voice/token';
import { voiceCallbackTwiml } from '@/lib/voice/twiml';

function xml(message: string, status = 200) {
  return new NextResponse(voiceCallbackTwiml(message), {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readIntegrationBody(request, 64 * 1024);
    const params = new URLSearchParams(rawBody);
    const config = await getVoiceConfig();
    const callbackUrl = `${getBaseUrl()}${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (
      !config.authToken ||
      !validateTwilioRequest(
        callbackUrl,
        params,
        request.headers.get('x-twilio-signature') || '',
        config.authToken
      )
    ) {
      return xml('This request could not be verified.', 401);
    }
    const claims = verifyVoiceCallbackToken(request.nextUrl.searchParams.get('token') || '');
    if (!claims) return xml('This acknowledgement link has expired or is invalid.', 401);
    const callSid = params.get('CallSid');
    if (!callSid) return xml('The call could not be identified.', 400);

    // 1. Look up the notification, binding via attempt when available.
    const notification = await prisma.notification.findFirst({
      where: {
        id: claims.notificationId,
        userId: claims.userId,
        incidentId: claims.incidentId,
        channel: 'VOICE',
      },
      select: {
        id: true,
        providerMessageId: true,
        user: { select: { id: true, name: true } },
        incident: { select: { status: true, escalationGeneration: true } },
      },
    });
    if (!notification?.user || !notification.incident) {
      return xml('This call is no longer actionable.', 404);
    }

    // 2. Validate lifecycle state BEFORE mutating any state.
    // Escalation generation must match to prevent stale callbacks from acting.
    if (notification.incident.escalationGeneration !== claims.escalationGeneration) {
      return xml('This page belongs to an earlier escalation and is no longer actionable.');
    }

    // 3. Explicitly handle non-OPEN incident states with truthful TwiML.
    if (notification.incident.status !== 'OPEN') {
      if (notification.incident.status === 'RESOLVED') {
        return xml('This incident is already resolved.');
      }
      if (notification.incident.status === 'ACKNOWLEDGED') {
        return xml('This incident is already acknowledged.');
      }
      // SNOOZED, SUPPRESSED, or any other non-OPEN state
      return xml('This incident is no longer awaiting acknowledgement.');
    }

    // 4. Verify Call SID matches this notification/attempt.
    if (claims.deliveryAttemptId) {
      // Attempt-level correlation: verify the Call SID belongs to this attempt.
      const attempt = await prisma.notificationDeliveryAttempt.findUnique({
        where: { id: claims.deliveryAttemptId },
        select: { providerMessageId: true, notificationId: true },
      });
      if (!attempt || attempt.notificationId !== notification.id) {
        return xml('This call is no longer actionable.', 404);
      }
      if (attempt.providerMessageId && attempt.providerMessageId !== callSid) {
        return xml('This call is no longer actionable.', 409);
      }
    } else {
      // Legacy path: notification-level binding for in-flight calls without attemptId.
      if (notification.providerMessageId && notification.providerMessageId !== callSid) {
        return xml('This call is no longer actionable.', 409);
      }
      const callBound = await prisma.notification.updateMany({
        where: {
          id: notification.id,
          OR: [{ providerMessageId: callSid }, { providerMessageId: null }],
        },
        data: { providerMessageId: callSid },
      });
      if (callBound.count === 0) return xml('This call is no longer actionable.', 409);
    }

    // 5. Check DTMF digits.
    if (params.get('Digits') !== '1') {
      return xml('No acknowledgement was received. The incident remains active.');
    }

    // 6. Idempotent ACK via provider feedback.
    const providerEventId = `${callSid}:voice-ack:${claims.nonce}`;
    try {
      await prisma.notificationProviderFeedback.create({
        data: {
          provider: 'twilio-voice',
          providerEventId,
          providerMessageId: callSid,
          eventType: 'acknowledged',
          occurredAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return xml('This incident acknowledgement was already received.');
      }
      throw error;
    }

    // 7. Execute canonical lifecycle command.
    try {
      await executeIncidentLifecycleCommand({
        incidentId: claims.incidentId,
        command: 'ACKNOWLEDGE',
        source: 'VOICE',
        actor: { id: notification.user.id, name: notification.user.name },
        expectedStatus: 'OPEN',
        eventMessage: `Incident acknowledged by ${notification.user.name} via voice call`,
      });
    } catch (error) {
      // The feedback row makes a concurrent/replayed callback harmless. If state
      // moved after validation, return a truthful message and never regress it.
      const current = await prisma.incident.findUnique({
        where: { id: claims.incidentId },
        select: { status: true },
      });
      if (current?.status === 'ACKNOWLEDGED') return xml('This incident is already acknowledged.');
      if (current?.status === 'RESOLVED') return xml('This incident is already resolved.');
      await prisma.notificationProviderFeedback.deleteMany({
        where: { provider: 'twilio-voice', providerEventId },
      });
      throw error;
    }

    // 8. Record attempt outcome.
    const attemptFilter = claims.deliveryAttemptId
      ? { id: claims.deliveryAttemptId }
      : { notificationId: notification.id, providerMessageId: callSid };
    await prisma.notificationDeliveryAttempt.updateMany({
      where: attemptFilter,
      data: { outcome: 'ACKNOWLEDGED', finishedAt: new Date() },
    });
    return xml('Thank you. The incident has been acknowledged.');
  } catch (error) {
    logger.error('voice.twilio_gather_failed', { error });
    return xml('The acknowledgement could not be processed. Please use OpsKnight.', 500);
  }
}
