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
    // Keyset-paginated, newest first: `limit` (default 100, max 500) versions per page, and
    // `beforeVersion` to continue. The body stays a plain array for compatibility; the next page is
    // advertised in the `X-Next-Before-Version` header.
    const searchParams = new URL(request.url).searchParams;
    const raw = Number(searchParams.get('limit'));
    const limit = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 500) : 100;
    const before = Number(searchParams.get('beforeVersion'));
    const beforeVersion = Number.isSafeInteger(before) && before > 0 ? before : null;
    const rows = await prisma.serviceObjective.findMany({
      where: {
        lineageId,
        ...serviceObjectiveReadWhere(actor),
        ...(beforeVersion ? { version: { lt: beforeVersion } } : {}),
      },
      orderBy: { version: 'desc' },
      take: limit + 1,
    });
    const versions = rows.slice(0, limit);
    if (versions.length === 0 && !beforeVersion) {
      return jsonError('Service objective not found', 404);
    }
    const response = jsonOk(
      versions.map(version => ({ ...version, id: version.lineageId, versionId: version.id }))
    );
    if (rows.length > limit) {
      response.headers.set('X-Next-Before-Version', String(versions[versions.length - 1].version));
    }
    return response;
  } catch (error) {
    return v1ErrorResponse(error, 'list service objective versions');
  }
}
