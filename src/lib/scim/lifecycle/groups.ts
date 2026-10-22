import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { invalidateSessionSecurityProjections } from '@/lib/session-security-projection';
import { runSerializableTransaction } from '@/lib/db-utils';
import { SCIM_LIST_SCHEMA, parseScimGroupFilter, serializeScimGroup } from '@/lib/scim';
import { authorize, recheck } from '../security/credentials';
import { groupSchema, pagination, parse, readBody, ScimFailure } from '../protocol/validation';
import { patchGroup, type GroupDocument } from '../protocol/patch';
import { json } from '../protocol/http';
import { event } from './events';
import { reconcileTeam } from './membership';

const include = {
  memberships: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;
type Group = Prisma.ScimGroupGetPayload<{ include: typeof include }>;
function serialize(group: Group, origin: string, exclude: boolean) {
  const result = serializeScimGroup({ ...group, members: group.memberships }, origin);
  if (exclude) {
    const { members: _members, ...without } = result;
    return without;
  }
  return result;
}
export async function groups(request: NextRequest, id?: string) {
  const principal = await authorize(
    request,
    request.method === 'GET' ? 'groups:read' : 'groups:write'
  );
  const origin = request.nextUrl.origin;
  const exclude = (request.nextUrl.searchParams.get('excludedAttributes') ?? '')
    .split(',')
    .some(a => a.trim().toLowerCase() === 'members');
  const selection = exclude ? { memberships: false as const } : include;
  if (request.method === 'GET') {
    if (id) {
      const group = await prisma.scimGroup.findFirst({
        where: { id, connectorId: principal.connectorId },
        include: selection,
      });
      if (!group) throw new ScimFailure(404, 'SCIM group not found.');
      return json(
        serialize(
          { ...group, memberships: 'memberships' in group ? group.memberships : [] } as Group,
          origin,
          exclude
        )
      );
    }
    const { startIndex, count } = pagination(request.nextUrl.searchParams);
    let filter;
    try {
      filter = parseScimGroupFilter(request.nextUrl.searchParams.get('filter'));
    } catch {
      throw new ScimFailure(
        400,
        'Use displayName eq, externalId eq or id eq filters.',
        'invalidFilter'
      );
    }
    const where = {
      connectorId: principal.connectorId,
      ...filter,
      ...(filter?.name ? { name: { equals: filter.name, mode: 'insensitive' as const } } : {}),
    };
    const [rows, totalResults] = await prisma.$transaction([
      prisma.scimGroup.findMany({
        where,
        include: selection,
        skip: startIndex - 1,
        take: count,
        orderBy: { id: 'asc' },
      }),
      prisma.scimGroup.count({ where }),
    ]);
    return json({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(group =>
        serialize(
          { ...group, memberships: 'memberships' in group ? group.memberships : [] } as Group,
          origin,
          exclude
        )
      ),
    });
  }
  const body = request.method === 'DELETE' ? null : await readBody(request);
  const changedUserIds = new Set<string>();
  const result = await runSerializableTransaction(async tx => {
    await recheck(tx, principal);
    const existing = id
      ? await tx.scimGroup.findFirst({
          where: { id, connectorId: principal.connectorId },
          include: { memberships: true, bindings: true },
        })
      : null;
    if (id && !existing) throw new ScimFailure(404, 'SCIM group not found.');
    if (request.method === 'DELETE' && existing) {
      // Reconcile before cascading bindings: their grant provenance is needed for revocation.
      const retiring = existing.bindings.map(binding => binding.id);
      const teams = [];
      for (const binding of existing.bindings) {
        const impact = await reconcileTeam(tx, binding.teamId, retiring);
        impact.changedUserIds.forEach(userId => changedUserIds.add(userId));
        teams.push({
          teamId: binding.teamId,
          revokedMemberships: impact.revokedMemberships,
          transferredGrants: impact.transferredGrants,
          coverageReviewRequired: impact.revokedMemberships > 0,
        });
      }
      await tx.scimGroup.delete({ where: { id: existing.id } });
      await event(tx, principal, 'group.deleted', existing.id, {
        policy: 'REVOKE_DIRECTORY_GRANTS',
        teams,
      });
      return null;
    }
    const current: GroupDocument | null = existing
      ? {
          displayName: existing.name,
          externalId: existing.scimExternalId ?? undefined,
          members: existing.memberships.map(m => ({ value: m.userId })),
        }
      : null;
    const document =
      request.method === 'PATCH' && current ? patchGroup(current, body) : parse(groupSchema, body);
    if (
      existing?.scimExternalId &&
      document.externalId &&
      document.externalId !== existing.scimExternalId
    )
      throw new ScimFailure(400, 'externalId is immutable.', 'mutability');
    const ids = [...new Set((document.members ?? []).map(m => m.value))];
    const found = await tx.scimIdentity.count({
      where: { connectorId: principal.connectorId, userId: { in: ids }, deletedAt: null },
    });
    if (found !== ids.length)
      throw new ScimFailure(
        400,
        'One or more members are unknown to this connector. Provision the users first.'
      );
    const group = existing
      ? await tx.scimGroup.update({
          where: { id: existing.id },
          data: {
            name: document.displayName,
            ...(!existing.scimExternalId && document.externalId
              ? { scimExternalId: document.externalId }
              : {}),
          },
        })
      : await tx.scimGroup.create({
          data: {
            connectorId: principal.connectorId,
            name: document.displayName,
            scimExternalId: document.externalId,
          },
        });
    await tx.scimGroupMembership.deleteMany({
      where: { groupId: group.id, userId: { notIn: ids } },
    });
    const previousIds = new Set(existing?.memberships.map(member => member.userId) ?? []);
    const additions = ids.filter(userId => !previousIds.has(userId));
    if (additions.length)
      await tx.scimGroupMembership.createMany({
        data: additions.map(userId => ({ groupId: group.id, userId })),
        skipDuplicates: true,
      });
    for (const binding of existing?.bindings ?? []) {
      const impact = await reconcileTeam(tx, binding.teamId);
      impact.changedUserIds.forEach(userId => changedUserIds.add(userId));
    }
    await event(tx, principal, existing ? 'group.updated' : 'group.created', group.id, {
      members: ids.length,
    });
    return tx.scimGroup.findUniqueOrThrow({ where: { id: group.id }, include });
  });
  invalidateSessionSecurityProjections([...changedUserIds]);
  if (!result) return new Response(null, { status: 204 });
  return json(
    serialize(result, origin, exclude),
    request.method === 'POST' ? 201 : 200,
    `${origin}/api/scim/v2/Groups/${result.id}`
  );
}
