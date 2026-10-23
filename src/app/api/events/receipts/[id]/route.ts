import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsed = z
    .object({ id: z.string().uuid() })
    .strict()
    .safeParse(await context.params);
  if (!parsed.success) return jsonError('Invalid receipt ID', 400);
  try {
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
