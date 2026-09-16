import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getWarRoomOperationalSnapshots } from '@/lib/war-room/operations/diagnostics';
import { summarizeOperationalHealth } from '@/lib/war-room/operations/summary';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return jsonError('Authentication required', 401);
  }
  // Admin Control Plane — admin only (responders can read via Teams page RSC, but API is admin-bound)
  if (user.role !== 'ADMIN') {
    return jsonError('Admin access required', 403);
  }

  const params = request.nextUrl.searchParams;
  const provider = params.get('provider')?.trim().toUpperCase() ?? null;
  const limitRaw = params.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;

  if (provider && !['SLACK', 'MICROSOFT_TEAMS'].includes(provider)) {
    return jsonError('Invalid provider filter', 400);
  }
  if (limitRaw && (!Number.isFinite(limit) || limit < 1 || limit > 200)) {
    return jsonError('Invalid limit (1-200)', 400);
  }

  try {
    const snapshots = await getWarRoomOperationalSnapshots(Number.isFinite(limit) ? limit : 100);
    const filtered = provider ? snapshots.filter(s => s.provider === provider) : snapshots;
    const summary = summarizeOperationalHealth(filtered);
    return jsonOk({ snapshots: filtered, summary }, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load war-room operations', 500);
  }
}
