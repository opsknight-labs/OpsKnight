import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';
import { v1ErrorResponse } from '@/lib/api-v1-errors';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentAuthorizationActor();
    const lineageId = (await params).id;
    // Bounded: newest first, `limit` (default 100, max 500) versions per request.
    const raw = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 500) : 100;
    const versions = await prisma.serviceObjective.findMany({
      where: { lineageId, ...serviceObjectiveReadWhere(actor) },
      orderBy: { version: 'desc' },
      take: limit,
    });
    if (versions.length === 0) return jsonError('Service objective not found', 404);
    return jsonOk(
      versions.map(version => ({ ...version, id: version.lineageId, versionId: version.id }))
    );
  } catch (error) {
    return v1ErrorResponse(error, 'list service objective versions');
  }
}
