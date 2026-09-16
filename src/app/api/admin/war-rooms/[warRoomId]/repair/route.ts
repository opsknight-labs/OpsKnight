import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { enqueueWarRoomRepair } from '@/lib/war-room/operations/repair';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['TEST_CONNECTION', 'RECONCILE', 'RETRY_PROJECTION', 'RETRY_PARTICIPANT_SYNC', 'RETRY_EXTERNAL_CLEANUP', 'REFRESH_PERMISSIONS']),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ warRoomId: string }> }
) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }
  // Admin Control Plane — mutations are ADMIN-only. A future incident-scoped
  // repair capability for responders would require assertCanModifyIncident().
  if (user.role !== 'ADMIN') {
    return jsonError('Admin access required', 403);
  }

  const { warRoomId } = await context.params;
  if (!warRoomId?.trim()) return jsonError('warRoomId is required', 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid repair request', 400);
  }

  try {
    const result = await enqueueWarRoomRepair({
      warRoomId: warRoomId.trim(),
      action: parsed.data.action,
      actorId: user.id,
      actorEmail: user.email,
      reason: parsed.data.reason ?? null,
    });

    if (!result.accepted) {
      const status = result.reasonCode === 'NOT_FOUND' ? 404 : result.reasonCode === 'FORBIDDEN' || result.reasonCode === 'UNAUTHORIZED' ? 403 : 422;
      return jsonError(result.message ?? 'Repair was not accepted', status);
    }

    // Never call Graph directly — repair enqueues a canonical durable job (WAR_ROOM_PROJECT/PARTICIPANT_SYNC/PROVISION reconciliationOnly etc.)
    // and the existing engine/adapter applies it. Idempotent: duplicate requests reuse the pending job.
    return jsonOk({ jobId: result.jobId ?? null, jobType: result.jobType ?? null }, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to enqueue repair', 500);
  }
}
