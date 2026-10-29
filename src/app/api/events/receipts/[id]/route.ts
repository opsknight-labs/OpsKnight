import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isIntegrationAuthorized } from '@/lib/integrations/auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsed = z
    .object({ id: z.string().uuid() })
    .strict()
    .safeParse(await context.params);
  if (!parsed.success) return jsonError('Invalid receipt ID', 400);
  try {
    const integrationId = request.nextUrl.searchParams.get('integrationId');
    if (integrationId !== null) {
      if (!z.string().min(1).max(512).safeParse(integrationId).success)
        return jsonError('Invalid integration ID', 400);
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        select: {
          id: true,
          serviceId: true,
          enabled: true,
          key: true,
          previousKey: true,
          previousKeyExpiresAt: true,
        },
      });
      if (
        !integration?.enabled ||
        !(await isIntegrationAuthorized(
          request,
          integration.key,
          integration.previousKey,
          integration.previousKeyExpiresAt
        ))
      )
        return jsonError('Authentication required', 401);
      const receipt = await prisma.ingestionReceipt.findUnique({
        where: { id: parsed.data.id },
        select: {
          id: true,
          serviceId: true,
          integrationId: true,
          status: true,
          attempts: true,
          acceptedAt: true,
          receivedAt: true,
          processingStartedAt: true,
          completedAt: true,
          failureCode: true,
          result: true,
        },
      });
      if (
        !receipt ||
        receipt.integrationId !== integration.id ||
        receipt.serviceId !== integration.serviceId
      )
        return jsonError('Receipt not found', 404);
      return jsonOk(receipt, 200, { 'Cache-Control': 'no-store' });
    }
    const key = await authenticateApiKey(request);
    if (!key) return jsonError('Authentication required', 401);
    const actor = await resolveApiKeyActor(key);
    if (!actor || !authorize({ actor, action: AUTHORIZATION_ACTIONS.EVENT_CREATE }).allowed) {
      return jsonError('Event access required', 403);
    }
    const receipt = await prisma.ingestionReceipt.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        serviceId: true,
        status: true,
        attempts: true,
        acceptedAt: true,
        receivedAt: true,
        processingStartedAt: true,
        completedAt: true,
        failureCode: true,
        result: true,
      },
    });
    if (!receipt) return jsonError('Receipt not found', 404);
    const service = await prisma.service.findUnique({
      where: { id: receipt.serviceId },
      select: { teamId: true },
    });
    if (
      !service ||
      !authorize({
        actor,
        action: AUTHORIZATION_ACTIONS.EVENT_CREATE,
        resource: { type: 'service', teamId: service.teamId },
      }).allowed
    )
      return jsonError('Receipt not found', 404);
    return jsonOk(receipt, 200, { 'Cache-Control': 'no-store' });
  } catch {
    return jsonError('Receipt status unavailable', 503);
  }
}
