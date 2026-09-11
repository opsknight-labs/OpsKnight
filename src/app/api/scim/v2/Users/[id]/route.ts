import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { isScimRequestAuthorized, scimError, serializeScimUser } from '@/lib/scim';

const select = {
  id: true,
  scimExternalId: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PatchOperation = { op?: unknown; path?: unknown; value?: unknown };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isScimRequestAuthorized(request.headers.get('authorization'))) {
    return scimError(401, 'Invalid SCIM bearer token.');
  }
  const { id } = await context.params;
  const user = await prisma.user.findFirst({
    where: { id, scimExternalId: { not: null } },
    select,
  });
  return user ? Response.json(serializeScimUser(user)) : scimError(404, 'SCIM user not found.');
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isScimRequestAuthorized(request.headers.get('authorization'))) {
    return scimError(401, 'Invalid SCIM bearer token.');
  }
  const { id } = await context.params;
  const existing = await prisma.user.findFirst({
    where: { id, scimExternalId: { not: null } },
    select: { ...select, role: true },
  });
  if (!existing) return scimError(404, 'SCIM user not found.');
  const body = (await request.json().catch(() => null)) as { Operations?: PatchOperation[] } | null;
  if (!Array.isArray(body?.Operations)) return scimError(400, 'Operations array is required.');
  let active = existing.status !== 'DISABLED';
  let name = existing.name;
  for (const operation of body.Operations) {
    if (String(operation.op).toLowerCase() !== 'replace') {
      return scimError(400, 'Only replace operations are supported.');
    }
    const path = String(operation.path).toLowerCase();
    if (path === 'active' && typeof operation.value === 'boolean') active = operation.value;
    else if (path === 'displayname' && typeof operation.value === 'string')
      name = operation.value.trim();
    else return scimError(400, `Unsupported SCIM patch path: ${String(operation.path)}`);
  }
  try {
    const user = await updateUserSecurityState(
      id,
      { status: active ? 'ACTIVE' : 'DISABLED' },
      {
        name: name || existing.name,
        roleSource: 'SCIM',
        ...(!active ? { tokenVersion: { increment: 1 } } : {}),
      }
    );
    await logAudit({
      action: active ? 'scim.user.updated' : 'scim.user.deprovisioned',
      entityType: 'USER',
      entityId: id,
      source: 'INTEGRATION',
      details: { externalId: existing.scimExternalId, active },
    });
    return Response.json(serializeScimUser(user));
  } catch (error) {
    return scimError(409, error instanceof Error ? error.message : 'SCIM update rejected.');
  }
}
