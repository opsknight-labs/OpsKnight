import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getWarRoomDiagnosticsSnapshot } from '@/lib/war-room/operations/diagnostics';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ warRoomId: string }> }
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

  const { warRoomId } = await context.params;
  if (!warRoomId?.trim()) return jsonError('warRoomId is required', 400);

  try {
    const diag = await getWarRoomDiagnosticsSnapshot(warRoomId.trim());
    if (!diag) return jsonError('War room not found', 404);
    return jsonOk(diag, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load diagnostics', 500);
  }
}
