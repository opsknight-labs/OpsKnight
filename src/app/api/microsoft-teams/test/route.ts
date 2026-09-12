import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { integrationProviderError, jsonProviderError } from '@/lib/provider-errors';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-url';

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
 * Sends a test Adaptive Card via direct Bot Framework transport (synchronous).
 * This bypasses the central Notification outbox / lifecyclePolicy so a synthetic
 * `test-*` incident never hits `lifecycleDeliveryRevoked` SKIPPED and the
 * response accurately reports sent vs failed — mirroring `src/app/api/slack/test`.
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

    // Direct Bot Framework send — no Notification row, no lifecycle fencing.
    let serviceName = dest.serviceId;
    try {
      const svc = await prisma.service.findUnique({ where: { id: dest.serviceId }, select: { name: true } });
      if (svc?.name) serviceName = svc.name;
    } catch {}
    const { sendMicrosoftTeamsIncidentCard } = await import('@/lib/microsoft-teams/client');
    let result: Awaited<ReturnType<typeof sendMicrosoftTeamsIncidentCard>>;
    try {
      result = await sendMicrosoftTeamsIncidentCard({
        tenantId: dest.tenantId,
        teamId: dest.teamId,
        channelId: dest.channelId,
        incident: {
          id: incidentId,
          title,
          description: 'If you see this Adaptive Card in Teams, the integration is working.',
          status: 'OPEN',
          urgency: 'MEDIUM',
          serviceName,
          incidentUrl: `${baseUrl}/services/${dest.serviceId}`,
          createdAt: now,
        },
        eventType: 'triggered',
      });
    } catch (error) {
      throw integrationProviderError({
        provider: 'microsoftTeams' as never,
        operation: 'sendBotActivity',
        cause: error,
      });
    }

    if (!result.success) {
      const providerCode = typeof result.errorCode === 'string' ? result.errorCode : undefined;
      const providerError = integrationProviderError({
        provider: 'microsoftTeams' as never,
        operation: 'sendBotActivity',
        providerCode,
        status: result.statusCode,
      });
      return jsonProviderError(providerError, {
        legacyError: result.error || 'Failed to send Teams test card',
        provider: 'microsoftTeams',
        providerCode,
      });
    }

    return jsonOk({ ok: true, destinationId: dest.id, providerMessageId: result.providerMessageId ?? null, conversationId: result.conversationId ?? null });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(error instanceof Error ? error.message : 'Failed to send Teams test', 500);
  }
}
