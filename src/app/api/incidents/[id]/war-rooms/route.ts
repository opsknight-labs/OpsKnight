import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';

/** Provider-neutral incident collaboration projection for the War Room panel. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await assertCanModifyIncident(id);
    const rooms = await prisma.incidentWarRoom.findMany({
      where: { incidentId: id }, orderBy: [{ provider: 'asc' }, { generation: 'desc' }],
      select: {
        id: true, provider: true, generation: true, state: true, providerChannelName: true,
        providerChannelUrl: true, membershipType: true, readyAt: true, closedAt: true,
        archivedAt: true, lastError: true, lastErrorCode: true,
        participants: { orderBy: { createdAt: 'asc' }, select: { id: true, userId: true, source: true, state: true, lastError: true, addedAt: true, user: { select: { name: true } } } },
      },
    });
    return jsonOk({ rooms });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to load incident war rooms.' }));
  }
}
