import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
import { jsonError, jsonOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const objective = await prisma.serviceObjective.findFirst({
    where: {
      id: (await params).id,
      OR: [{ serviceId: null }, { service: serviceReadWhere(actor) }],
    },
  });
  if (!objective) return jsonError('Service objective not found', 404);
  return jsonOk(await evaluateServiceObjective({ actor, objective }));
}
