import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { requeueCentralNotification } from '@/lib/notification-control-plane';
import { emitAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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
  if (origin !== request.nextUrl.origin) {
    return jsonError('Invalid request origin', 403);
  }

  const { id } = await context.params;
  if (!/^notification_[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return jsonError('Invalid notification ID', 400);
  }

  try {
    const requeued = await requeueCentralNotification(id);
    if (!requeued) {
      return jsonError('Notification is not eligible for another delivery attempt', 409);
    }
    await emitAuditEvent({
      action: 'NOTIFICATION_DELIVERY_REQUEUED',
      source: 'UI',
      actor: { type: 'USER', id: user.id, email: user.email, name: user.name },
      target: { type: 'SYSTEM_CONFIG', id },
      metadata: { notificationId: id },
    });
    return jsonOk({ requeued: true }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    logger.error('api.admin.notifications.retry.failed', {
      actorId: user.id,
      notificationId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Unable to requeue notification', 500);
  }
}
