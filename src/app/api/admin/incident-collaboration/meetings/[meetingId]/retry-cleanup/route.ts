import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { retryIncidentMeetingCleanup } from '@/lib/incident-collaboration/meeting-reconciliation';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ meetingId: string }> }
) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }

  if (user.role !== 'ADMIN') {
    return jsonError('Admin access required', 403);
  }

  const { meetingId } = await context.params;
  if (!meetingId?.trim()) {
    return jsonError('meetingId is required', 400);
  }

  const result = await retryIncidentMeetingCleanup(meetingId.trim(), user.id);
  if (!result.success) {
    return jsonError(result.error || 'Failed to trigger cleanup retry', 400);
  }

  return jsonOk({ success: true, jobId: result.jobId, meetingId: meetingId.trim() }, 200, {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  });
}
