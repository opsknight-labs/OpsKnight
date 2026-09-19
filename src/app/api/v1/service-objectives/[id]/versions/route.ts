import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const lineageId = (await params).id;
  const versions = await prisma.serviceObjective.findMany({
    where: { lineageId, ...serviceObjectiveReadWhere(actor) },
    orderBy: { version: 'desc' },
  });
  if (versions.length === 0) return jsonError('Service objective not found', 404);
  return jsonOk(
    versions.map(version => ({ ...version, id: version.lineageId, versionId: version.id }))
  );
}
