import { NextRequest, NextResponse } from 'next/server';
import { getIncidentContext } from '@/lib/incident-enrichment';
import { assertCanViewIncident } from '@/lib/rbac';
import { logger } from '@/lib/logger';

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json({ error: msg }, { status: msg === 'Incident not found' ? 404 : 403 });
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
