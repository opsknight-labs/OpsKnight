import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getDefaultAvatar, isDefaultAvatar } from '@/lib/avatar';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { isScimRequestAuthorized, scimError, serializeScimUser } from '@/lib/scim';

const select = {
  id: true,
  scimExternalId: true,
  email: true,
  name: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PatchOperation = { op?: unknown; path?: unknown; value?: unknown };

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) && email.length <= 320 ? email : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }
  return null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await isScimRequestAuthorized(request.headers.get('authorization')))) {
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
  if (!(await isScimRequestAuthorized(request.headers.get('authorization')))) {
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
  let avatarUrl = existing.avatarUrl;

  for (const operation of body.Operations) {
    const op = String(operation.op ?? '').toLowerCase();
    if (op !== 'replace' && op !== 'add') {
      return scimError(400, 'Only add and replace operations are supported.');
    }
    const path = typeof operation.path === 'string' ? operation.path.trim().toLowerCase() : '';
    if (path === 'active') {
      const parsed = parseBoolean(operation.value);
      if (parsed === null) return scimError(400, 'Invalid active boolean value in SCIM patch.');
      active = parsed;
    } else if (path === 'displayname' && typeof operation.value === 'string') {
      name = operation.value.trim();
    } else if (
      (path === 'name' || path === 'name.formatted') &&
      typeof operation.value === 'string'
    ) {
      name = operation.value.trim();
    } else if (
      (path === 'name' || path === 'name.formatted') &&
      typeof operation.value === 'object' &&
      operation.value !== null &&
      'formatted' in operation.value &&
      typeof (operation.value as { formatted: unknown }).formatted === 'string'
    ) {
      name = ((operation.value as { formatted: string }).formatted || '').trim();
    } else if (path === 'photos' || path === 'avatarurl') {
      if (typeof operation.value === 'string' && /^https?:\/\//i.test(operation.value)) {
        avatarUrl = operation.value.trim();
      } else if (Array.isArray(operation.value)) {
        const photoVal = operation.value[0]?.value;
        if (typeof photoVal === 'string' && /^https?:\/\//i.test(photoVal)) {
          avatarUrl = photoVal.trim();
        }
      }
    } else if (!path && typeof operation.value === 'object' && operation.value !== null) {
      const valObj = operation.value as Record<string, unknown>;
      if ('active' in valObj) {
        const parsed = parseBoolean(valObj.active);
        if (parsed !== null) active = parsed;
      }
      if (typeof valObj.displayName === 'string') {
        name = valObj.displayName.trim();
      } else if (typeof valObj['name.formatted'] === 'string') {
        name = valObj['name.formatted'].trim();
      }
      if (typeof valObj.avatarUrl === 'string' && /^https?:\/\//i.test(valObj.avatarUrl)) {
        avatarUrl = valObj.avatarUrl.trim();
      }
    }
  }

  // If name changed and user had default system avatar, update avatar to new initials
  if (name !== existing.name && isDefaultAvatar(avatarUrl)) {
    avatarUrl = getDefaultAvatar(name, existing.scimExternalId ?? existing.id);
  }

  try {
    const user = await updateUserSecurityState(
      id,
      { status: active ? 'ACTIVE' : 'DISABLED' },
      {
        name: name || existing.name,
        avatarUrl,
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

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await isScimRequestAuthorized(request.headers.get('authorization')))) {
    return scimError(401, 'Invalid SCIM bearer token.');
  }
  const { id } = await context.params;
  const existing = await prisma.user.findFirst({
    where: { id, scimExternalId: { not: null } },
    select: { ...select, role: true },
  });
  if (!existing) return scimError(404, 'SCIM user not found.');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normalizedEmail(body?.userName);
  if (!email) return scimError(400, 'A valid userName email is required.');
  if (typeof body?.externalId === 'string' && body.externalId.trim() !== existing.scimExternalId) {
    return scimError(409, 'externalId is immutable for an existing SCIM resource.');
  }
  const name =
    typeof body?.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 320)
      : existing.name;
  const active = body?.active !== false;

  let avatarUrl = existing.avatarUrl;
  if (Array.isArray(body?.photos)) {
    const photoObj = body.photos[0];
    if (
      typeof photoObj === 'object' &&
      photoObj !== null &&
      'value' in photoObj &&
      typeof (photoObj as { value: unknown }).value === 'string' &&
      /^https?:\/\//i.test((photoObj as { value: string }).value)
    ) {
      avatarUrl = (photoObj as { value: string }).value.trim();
    }
  } else if (name !== existing.name && isDefaultAvatar(avatarUrl)) {
    avatarUrl = getDefaultAvatar(name, existing.scimExternalId ?? existing.id);
  }

  try {
    const user = await updateUserSecurityState(
      id,
      { status: active ? 'ACTIVE' : 'DISABLED' },
      {
        email,
        name,
        avatarUrl,
        roleSource: 'SCIM',
        tokenVersion: { increment: 1 },
      }
    );
    await logAudit({
      action: active ? 'scim.user.updated' : 'scim.user.deprovisioned',
      entityType: 'USER',
      entityId: id,
      source: 'INTEGRATION',
      details: { externalId: existing.scimExternalId, active, method: 'PUT' },
    });
    return Response.json(serializeScimUser(user));
  } catch (error) {
    return scimError(409, error instanceof Error ? error.message : 'SCIM replacement rejected.');
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await isScimRequestAuthorized(request.headers.get('authorization')))) {
    return scimError(401, 'Invalid SCIM bearer token.');
  }
  const { id } = await context.params;
  const existing = await prisma.user.findFirst({
    where: { id, scimExternalId: { not: null } },
    select: { id: true, scimExternalId: true },
  });
  if (!existing) return scimError(404, 'SCIM user not found.');

  try {
    await updateUserSecurityState(
      id,
      { status: 'DISABLED' },
      {
        // DELETE removes the resource from the external SCIM namespace while
        // retaining the disabled OpsKnight account for audit/history.
        scimExternalId: null,
        roleSource: 'SCIM',
        tokenVersion: { increment: 1 },
      }
    );
    await logAudit({
      action: 'scim.user.deprovisioned',
      entityType: 'USER',
      entityId: id,
      source: 'INTEGRATION',
      details: { externalId: existing.scimExternalId, active: false, method: 'DELETE' },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return scimError(409, error instanceof Error ? error.message : 'SCIM deletion rejected.');
  }
}
