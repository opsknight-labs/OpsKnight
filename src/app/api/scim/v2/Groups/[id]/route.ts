import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { isScimRequestAuthorized, scimError, serializeScimGroup } from '@/lib/scim';

type PatchOperation = { op?: unknown; path?: unknown; value?: unknown };

async function authorized(request: NextRequest): Promise<boolean> {
  return await isScimRequestAuthorized(request.headers.get('authorization'));
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const { id } = await context.params;
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!team) return scimError(404, 'SCIM group not found.');
  const baseUrl = request.nextUrl.origin;
  return Response.json(serializeScimGroup(team, baseUrl), {
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const { id } = await context.params;
  const existing = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!existing) return scimError(404, 'SCIM group not found.');

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : undefined;

  if (!displayName) {
    return scimError(400, 'displayName is required.');
  }

  // Check name uniqueness if changed
  if (displayName !== existing.name) {
    const collision = await prisma.team.findFirst({
      where: { name: displayName, id: { not: id } },
      select: { id: true },
    });
    if (collision) {
      return scimError(409, 'A group with this displayName already exists.');
    }
  }

  try {
    const updated = await prisma.$transaction(async tx => {
      await tx.team.update({
        where: { id },
        data: {
          name: displayName,
          ...(externalId !== undefined ? { scimExternalId: externalId || null } : {}),
        },
      });

      // Synchronize members if passed
      if (Array.isArray(body?.members)) {
        await tx.teamMember.deleteMany({ where: { teamId: id } });
        for (const m of body.members as Array<{ value?: unknown }>) {
          const userId = typeof m?.value === 'string' ? m.value.trim() : null;
          if (userId) {
            const user = await tx.user.findUnique({
              where: { id: userId },
              select: { id: true },
            });
            if (user) {
              await tx.teamMember.create({
                data: {
                  teamId: id,
                  userId: user.id,
                  role: 'MEMBER',
                },
              });
            }
          }
        }
      }

      return tx.team.findUniqueOrThrow({
        where: { id },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    });

    await logAudit({
      action: 'scim.group.updated',
      entityType: 'TEAM',
      entityId: id,
      source: 'INTEGRATION',
      details: { displayName, memberCount: updated.members.length },
    });

    const baseUrl = request.nextUrl.origin;
    return Response.json(serializeScimGroup(updated, baseUrl), {
      headers: {
        'Content-Type': 'application/scim+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return scimError(
      500,
      error instanceof Error ? error.message : 'Internal error updating SCIM group.'
    );
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const { id } = await context.params;
  const existing = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        select: { userId: true },
      },
    },
  });
  if (!existing) return scimError(404, 'SCIM group not found.');

  const body = (await request.json().catch(() => null)) as { Operations?: PatchOperation[] } | null;
  if (!Array.isArray(body?.Operations)) return scimError(400, 'Operations array is required.');

  let nextName = existing.name;
  const membersToAdd = new Set<string>();
  const membersToRemove = new Set<string>();
  let replaceAllMembers: string[] | null = null;

  for (const operation of body.Operations) {
    const op = String(operation.op ?? '').toLowerCase();
    const path = typeof operation.path === 'string' ? operation.path.trim() : '';

    if (op !== 'add' && op !== 'remove' && op !== 'replace') {
      return scimError(400, 'Only add, remove, and replace operations are supported.');
    }

    // 1. Rename group: displayName
    if (path.toLowerCase() === 'displayname') {
      if (typeof operation.value === 'string' && operation.value.trim()) {
        nextName = operation.value.trim();
      }
    } else if (!path && typeof operation.value === 'object' && operation.value !== null) {
      const valObj = operation.value as Record<string, unknown>;
      if (typeof valObj.displayName === 'string' && valObj.displayName.trim()) {
        nextName = valObj.displayName.trim();
      }
      if (Array.isArray(valObj.members)) {
        if (op === 'replace') {
          replaceAllMembers = valObj.members
            .map(m => (typeof m?.value === 'string' ? m.value.trim() : ''))
            .filter(Boolean);
        } else if (op === 'add') {
          for (const m of valObj.members) {
            if (typeof m?.value === 'string' && m.value.trim()) {
              membersToAdd.add(m.value.trim());
            }
          }
        }
      }
    }

    // 2. Members operations
    // Handle path "members[value eq \"...\"]" (standard Entra ID / Okta member removal)
    const removeMatch = /^members\[value\s+eq\s+"([^"\r\n]+)"\]$/i.exec(path);
    if (removeMatch) {
      if (op === 'remove') {
        membersToRemove.add(removeMatch[1].trim());
      }
    } else if (path.toLowerCase() === 'members') {
      if (op === 'add') {
        if (Array.isArray(operation.value)) {
          for (const m of operation.value as Array<{ value?: unknown }>) {
            if (typeof m?.value === 'string' && m.value.trim()) {
              membersToAdd.add(m.value.trim());
            }
          }
        } else if (typeof operation.value === 'object' && operation.value !== null) {
          const val = (operation.value as { value?: unknown }).value;
          if (typeof val === 'string' && val.trim()) {
            membersToAdd.add(val.trim());
          }
        }
      } else if (op === 'remove') {
        if (Array.isArray(operation.value)) {
          for (const m of operation.value as Array<{ value?: unknown }>) {
            if (typeof m?.value === 'string' && m.value.trim()) {
              membersToRemove.add(m.value.trim());
            }
          }
        } else if (!operation.value) {
          // Remove all members
          replaceAllMembers = [];
        }
      } else if (op === 'replace') {
        if (Array.isArray(operation.value)) {
          replaceAllMembers = (operation.value as Array<{ value?: unknown }>)
            .map(m => (typeof m?.value === 'string' ? m.value.trim() : ''))
            .filter(Boolean);
        }
      }
    }
  }

  // Check for displayName collision if renamed
  if (nextName !== existing.name) {
    const collision = await prisma.team.findFirst({
      where: { name: nextName, id: { not: id } },
      select: { id: true },
    });
    if (collision) {
      return scimError(409, 'A group with this displayName already exists.');
    }
  }

  try {
    const updated = await prisma.$transaction(async tx => {
      if (nextName !== existing.name) {
        await tx.team.update({
          where: { id },
          data: { name: nextName },
        });
      }

      if (replaceAllMembers !== null) {
        await tx.teamMember.deleteMany({ where: { teamId: id } });
        for (const userId of replaceAllMembers) {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true },
          });
          if (user) {
            await tx.teamMember.create({
              data: { teamId: id, userId: user.id, role: 'MEMBER' },
            });
          }
        }
      } else {
        // Remove members
        if (membersToRemove.size > 0) {
          await tx.teamMember.deleteMany({
            where: {
              teamId: id,
              userId: { in: Array.from(membersToRemove) },
            },
          });
        }

        // Add members
        if (membersToAdd.size > 0) {
          for (const userId of membersToAdd) {
            const user = await tx.user.findUnique({
              where: { id: userId },
              select: { id: true },
            });
            if (user) {
              await tx.teamMember.upsert({
                where: {
                  userId_teamId: {
                    userId: user.id,
                    teamId: id,
                  },
                },
                create: {
                  teamId: id,
                  userId: user.id,
                  role: 'MEMBER',
                },
                update: {},
              });
            }
          }
        }
      }

      return tx.team.findUniqueOrThrow({
        where: { id },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    });

    await logAudit({
      action: 'scim.group.patched',
      entityType: 'TEAM',
      entityId: id,
      source: 'INTEGRATION',
      details: {
        displayName: nextName,
        membersAdded: Array.from(membersToAdd),
        membersRemoved: Array.from(membersToRemove),
        totalMembers: updated.members.length,
      },
    });

    const baseUrl = request.nextUrl.origin;
    return Response.json(serializeScimGroup(updated, baseUrl), {
      headers: {
        'Content-Type': 'application/scim+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return scimError(
      500,
      error instanceof Error ? error.message : 'Internal error patching SCIM group.'
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const { id } = await context.params;
  const existing = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!existing) return scimError(404, 'SCIM group not found.');

  try {
    await prisma.$transaction(async tx => {
      await tx.teamMember.deleteMany({ where: { teamId: id } });
      await tx.team.delete({ where: { id } });
    });

    await logAudit({
      action: 'scim.group.deleted',
      entityType: 'TEAM',
      entityId: id,
      source: 'INTEGRATION',
      details: { displayName: existing.name },
    });

    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return scimError(
      500,
      error instanceof Error ? error.message : 'Internal error deleting SCIM group.'
    );
  }
}
