import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getTeamsGrantedRscPermissions } from '@/lib/microsoft-teams/client';
import { getMicrosoftTeamsHealthChecklist } from '@/lib/microsoft-teams/health-checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/microsoft-teams/health — the settings health checklist as JSON (admins only). */
export async function GET() {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Admin access required.', 403);
  }
  try {
    const rscState = await getTeamsGrantedRscPermissions().catch(() => null);
    const checklist = await getMicrosoftTeamsHealthChecklist({ rscState });
    const healthy = checklist.checks.every(c => c.status !== 'fail');
    return jsonOk({ ok: healthy, ...checklist }, 200, { 'Cache-Control': 'private, no-store' });
  } catch {
    return jsonError('Failed to run the Teams health check.', 500);
  }
}
