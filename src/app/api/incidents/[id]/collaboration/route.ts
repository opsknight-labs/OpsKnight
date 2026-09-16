import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { getIncidentCollaborationView } from '@/lib/incident-collaboration/get-incident-collaboration';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await assertCanViewIncident(id);
    const userPermissions = await getUserPermissions();

    const collaboration = await getIncidentCollaborationView({
      incidentId: id,
      userId: userPermissions.id || undefined,
    });

    return jsonOk(collaboration);
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Unable to load incident collaboration details.',
          })
    );
  }
}
