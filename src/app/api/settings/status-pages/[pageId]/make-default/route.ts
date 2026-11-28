import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { jsonError, jsonOk } from '@/lib/api-response';
import { makeDefaultStatusPage, StatusPageAdminError } from '@/lib/status-pages/admin';

export async function POST(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  try {
    const admin = await assertAdmin();
    const { pageId } = await context.params;
    const page = await makeDefaultStatusPage(pageId, tx =>
      logAudit(
        {
          action: 'status_page.updated',
          entityType: 'STATUS_PAGE',
          entityId: pageId,
          actorId: admin.id,
          details: { isDefault: true },
        },
        tx
      )
    );
    return jsonOk({ page }, 200);
  } catch (error) {
    if (error instanceof StatusPageAdminError) return jsonError(error.message, 404);
    return jsonError('Failed to change the default status page.', 500);
  }
}
