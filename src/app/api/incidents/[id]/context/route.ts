import { NextRequest, NextResponse } from 'next/server';
import { getIncidentContext } from '@/lib/incident-enrichment';
import { assertCanViewIncident } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { jsonError } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';

/**
 * GET: Fetch telemetry context for an incident
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !/^[a-z0-9_-]{1,64}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid incident ID' }, { status: 400 });
  }

  try {
    await assertCanViewIncident(id);
  } catch (error) {
    if (isAppError(error)) return jsonError(error);

    logger.error('api.incident_context.authorization_failed', { error, incidentId: id });
    return jsonError(
      new AppError({
        code: 'INTERNAL_ERROR',
        details: { incidentId: id },
        cause: error,
      })
    );
  }

  const { searchParams } = new URL(request.url);
  const windowMinutes = parseInt(searchParams.get('window') || '30', 10);

  try {
    const context = await getIncidentContext(id, windowMinutes);
    if (!context) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }
    return NextResponse.json(context);
  } catch (error) {
    logger.error('api.incident_context.fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to get context' }, { status: 500 });
  }
}
