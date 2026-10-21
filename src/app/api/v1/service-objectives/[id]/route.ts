import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { serviceObjectiveUpdateSchema } from '@/lib/slo/schemas';
import { jsonError, jsonOk } from '@/lib/api-response';
import { v1ErrorResponse } from '@/lib/api-v1-errors';
import { updateServiceObjective, archiveServiceObjective } from '@/lib/slo/commands';
import { runSerializableTransaction } from '@/lib/db-utils';

const idSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/i);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentAuthorizationActor();
    const id = idSchema.parse((await params).id);
    const objective = await prisma.serviceObjective.findFirst({
      where: {
        lineageId: id,
        activeTo: null,
        ...serviceObjectiveReadWhere(actor),
      },
      include: { service: { select: { id: true, name: true } } },
    });
    return objective
      ? jsonOk({ ...objective, id: objective.lineageId, versionId: objective.id })
      : jsonError('Service objective not found', 404);
  } catch (error) {
    return v1ErrorResponse(error, 'read service objective');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    actor = await assertAdmin();
  } catch {
    return jsonError('Admin access required', 403);
  }
  try {
    const id = idSchema.parse((await params).id);
    const data = serviceObjectiveUpdateSchema.parse(await request.json());
    const next = await runSerializableTransaction(tx =>
      updateServiceObjective(tx, id, data, { id: actor.id, source: 'UI' })
    );
    if (!next) return jsonError('Active service objective not found', 409);
    return jsonOk({ ...next, id: next.lineageId, versionId: next.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError('Validation failed', 400, { details: error.errors });
    }
    return v1ErrorResponse(error, 'update service objective');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor: Awaited<ReturnType<typeof assertAdmin>>;
  try {
    actor = await assertAdmin();
  } catch {
    return jsonError('Admin access required', 403);
  }
  try {
    const id = idSchema.parse((await params).id);
    await runSerializableTransaction(tx =>
      archiveServiceObjective(tx, id, { id: actor.id, source: 'UI' })
    );
    return jsonOk({ success: true });
  } catch (error) {
    return v1ErrorResponse(error, 'archive service objective');
  }
}
