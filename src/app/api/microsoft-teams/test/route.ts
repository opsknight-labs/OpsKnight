import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { incidentNotificationPriority } from '@/lib/notification-priority';

const teamsTestSchema = z
  .object({
    destinationId: z.string().trim().min(1).max(191).optional(),
    serviceId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine(v => Boolean(v.destinationId || v.serviceId), {
    message: 'destinationId or serviceId is required.',
  });

/**
 * POST /api/microsoft-teams/test
 * Body: { destinationId: string } | { serviceId: string }
 *
 * Sends a test Adaptive Card via the durable control plane (idempotent, rate-limited).
 */
export async function POST(request: NextRequest) {
  try {
    await assertAdmin();
    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: e as Error }));
    }
    const parsed = teamsTestSchema.safeParse((body ?? {}) as Record<string, unknown>);
    if (!parsed.success) {
      return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: parsed.error.issues[0]?.message ?? 'Invalid request.' }));
    }
    const { destinationId, serviceId } = parsed.data as { destinationId?: string; serviceId?: string };

    const prismaAny = prisma as unknown as {
      microsoftTeamsDestination: {
        findUnique: (a: unknown) => Promise<{ id: string; serviceId: string; tenantId: string; teamId: string; channelId: string } | null>;
        findFirst: (a: unknown) => Promise<{ id: string; serviceId: string; tenantId: string; teamId: string; channelId: string } | null>;
      };
    };
    let dest: { id: string; serviceId: string; tenantId: string; teamId: string; channelId: string } | null = null;
    if (destinationId) {
      dest = await prismaAny.microsoftTeamsDestination.findUnique({ where: { id: destinationId } });
    } else if (serviceId) {
      dest = await prismaAny.microsoftTeamsDestination.findFirst({ where: { serviceId } });
    }
    if (!dest) {
      return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Teams destination not found. Map a Service → Teams channel first.' }));
    }

    const baseUrl = await getAppUrl();
    const incidentId = `test-${Date.now()}`;
    const title = 'OpsKnight Teams test — Adaptive Card';
    const now = new Date();
    const eventType = 'triggered' as const;
    const deliveryKey = `teams-test:${dest.id}:${now.toISOString()}`;

    await enqueueCentralNotification({
      category: 'INCIDENT',
      channel: 'MICROSOFT_TEAMS' as never,
      recipientType: 'MICROSOFT_TEAMS_CHANNEL' as never,
      recipientId: dest.id,
      recipientAddress: `${dest.tenantId}:${dest.teamId}:${dest.channelId}`,
      templateKey: `service-microsoft-teams-${eventType}`,
      sourceType: 'SERVICE_INCIDENT',
      sourceId: `${dest.serviceId}:${incidentId}`,
      eventKey: deliveryKey,
      displayMessage: `${eventType}: ${title}`,
      ...incidentNotificationPriority({ eventType, priority: 'P3', urgency: 'MEDIUM' }),
      payload: {
        kind: 'MICROSOFT_TEAMS_CHANNEL',
        destinationId: dest.id,
        incident: {
          id: incidentId,
          title,
          description: 'If you see this Adaptive Card in Teams, the integration is working.',
          status: 'OPEN',
          urgency: 'MEDIUM',
          serviceName: dest.serviceId,
          incidentUrl: `${baseUrl}/services/${dest.serviceId}`,
          createdAt: now,
        },
        eventType,
        lifecyclePolicy: {
          incidentId,
          eventType,
          serviceId: dest.serviceId,
          targetKind: 'SERVICE_MICROSOFT_TEAMS_CHANNEL',
          targetId: dest.id,
          targetAddress: dest.channelId,
        },
      } as never,
    });

    return jsonOk({ ok: true, destinationId: dest.id });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(error instanceof Error ? error.message : 'Failed to send Teams test', 500);
  }
}
