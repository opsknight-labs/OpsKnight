/* eslint-disable security/detect-object-injection -- Attribute keys are restricted by strict SCIM schemas and explicit path allowlists. */
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { getDefaultAvatar } from '@/lib/avatar';
import { SCIM_LIST_SCHEMA, parseScimFilter, serializeScimUser } from '@/lib/scim';
import { authorize, recheck } from '../security/credentials';
import {
  enterpriseSchema,
  pagination,
  parse,
  readBody,
  ScimFailure,
  userSchema,
} from '../protocol/validation';
import { patchUser, type UserDocument } from '../protocol/patch';
import { json } from '../protocol/http';
import { event } from './events';
import { reconcileTeam } from './membership';
import { applyProfileAuthority, requestedProfileFields } from './profile';

function profile(document: UserDocument): {
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  avatarUrl: string | null;
} {
  const name =
    document.displayName ||
    document.name?.formatted ||
    [document.name?.givenName, document.name?.familyName].filter(Boolean).join(' ') ||
    document.userName.split('@')[0];
  return {
    email: document.userName,
    name,
    jobTitle: document.title ?? null,
    department: document[enterpriseSchema]?.department ?? null,
    scimGivenName: document.name?.givenName ?? null,
    scimFamilyName: document.name?.familyName ?? null,
    avatarUrl:
      document.photos?.[0]?.value ??
      getDefaultAvatar(name, document.externalId ?? document.userName),
  };
}
export async function users(request: NextRequest, id?: string) {
  if (!id && !['GET', 'POST'].includes(request.method)) {
    const response = json(
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '405',
        detail: 'Use a resource URL for mutations.',
      },
      405
    );
    response.headers.set('Allow', 'GET, POST');
    return response;
  }
  const principal = await authorize(
    request,
    request.method === 'GET' ? 'users:read' : 'users:write'
  );
  const origin = request.nextUrl.origin;
  if (request.method === 'GET') {
    if (id) {
      const identity = await prisma.scimIdentity.findFirst({
        where: { connectorId: principal.connectorId, userId: id, deletedAt: null },
        include: { user: true },
      });
      if (!identity) throw new ScimFailure(404, 'SCIM user not found.');
      return json(
        serializeScimUser({ ...identity.user, scimExternalId: identity.externalId }, origin)
      );
    }
    const { startIndex, count } = pagination(request.nextUrl.searchParams);
    let filter;
    try {
      filter = parseScimFilter(request.nextUrl.searchParams.get('filter'));
    } catch {
      throw new ScimFailure(400, 'Use userName eq or externalId eq filters.', 'invalidFilter');
    }
    const where = {
      connectorId: principal.connectorId,
      deletedAt: null,
      ...(filter && 'scimExternalId' in filter
        ? { externalId: filter.scimExternalId }
        : filter
          ? { user: { email: filter.email } }
          : {}),
    };
    const [rows, totalResults] = await prisma.$transaction([
      prisma.scimIdentity.findMany({
        where,
        include: { user: true },
        skip: startIndex - 1,
        take: count,
        orderBy: { userId: 'asc' },
      }),
      prisma.scimIdentity.count({ where }),
    ]);
    return json({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(row =>
        serializeScimUser({ ...row.user, scimExternalId: row.externalId }, origin)
      ),
    });
  }
  const body = request.method === 'DELETE' ? null : await readBody(request);
  if (request.method === 'POST' && !id) {
    const document = parse(userSchema, body);
    // Explicit connector contract: immutable externalId is required for safe retries/rehire.
    if (!document.externalId)
      throw new ScimFailure(400, 'Map the immutable directory object identifier to externalId.');
    const created = await runSerializableTransaction(async tx => {
      await recheck(tx, principal);
      const connector = await tx.scimConnector.findUniqueOrThrow({
        where: { id: principal.connectorId },
      });
      const requested = requestedProfileFields(document, 'POST');
      for (const field of requested)
        if (
          ['name', 'title', 'department', 'photos'].includes(field) &&
          !connector.profileFields.includes(field)
        )
          throw new ScimFailure(
            400,
            `${field} is managed outside this SCIM connection.`,
            'mutability'
          );
      const bound = await tx.scimIdentity.findUnique({
        where: {
          connectorId_externalId: {
            connectorId: principal.connectorId,
            externalId: document.externalId!,
          },
        },
      });
      if (bound)
        throw new ScimFailure(
          409,
          bound.deletedAt
            ? 'This identity was deleted. An administrator must approve restoration.'
            : 'Directory identity already exists. Query externalId and update the existing resource.',
          'uniqueness'
        );
      const user = await tx.user.create({
        data: {
          ...profile(document),
          status: document.active === false ? 'DISABLED' : 'ACTIVE',
          role: 'USER',
          roleSource: 'MANUAL',
        },
      });
      await tx.scimIdentity.create({
        data: {
          connectorId: principal.connectorId,
          externalId: document.externalId!,
          userId: user.id,
        },
      });
      await event(tx, principal, 'user.created', user.id, { active: user.status === 'ACTIVE' });
      return user;
    });
    const location = `${origin}/api/scim/v2/Users/${created.id}`;
    return json(
      serializeScimUser({ ...created, scimExternalId: document.externalId }, origin),
      201,
      location
    );
  }
  if (!id) throw new ScimFailure(405, 'A user resource URL is required.');
  const updated = await runSerializableTransaction(async tx => {
    await recheck(tx, principal);
    const identity = await tx.scimIdentity.findFirst({
      where: { userId: id, connectorId: principal.connectorId, deletedAt: null },
      include: { user: true },
    });
    if (!identity) throw new ScimFailure(404, 'SCIM user not found.');
    const existing = identity.user;
    const connector = await tx.scimConnector.findUniqueOrThrow({
      where: { id: principal.connectorId },
    });
    const current: UserDocument = {
      userName: existing.email,
      externalId: identity.externalId,
      displayName: existing.name,
      active: existing.status !== 'DISABLED',
      title: existing.jobTitle,
      name: {
        formatted: existing.name,
        givenName: existing.scimGivenName ?? undefined,
        familyName: existing.scimFamilyName ?? undefined,
      },
      [enterpriseSchema]: { department: existing.department },
      ...(existing.avatarUrl && /^https?:\/\//i.test(existing.avatarUrl)
        ? { photos: [{ value: existing.avatarUrl }] }
        : {}),
    };
    const document =
      request.method === 'DELETE'
        ? current
        : request.method === 'PATCH'
          ? patchUser(current, body)
          : parse(userSchema, body);
    if (document.externalId && document.externalId !== identity.externalId)
      throw new ScimFailure(400, 'externalId is immutable.', 'mutability');
    const active =
      request.method !== 'DELETE' && (document.active ?? existing.status !== 'DISABLED');
    const revoke =
      (existing.status !== 'DISABLED' && !active) || existing.email !== document.userName;
    const nextProfile = profile(document);
    if (!document.photos && nextProfile.name === existing.name)
      nextProfile.avatarUrl = existing.avatarUrl ?? nextProfile.avatarUrl;
    if (request.method !== 'DELETE')
      applyProfileAuthority(
        nextProfile,
        existing,
        connector.profileFields,
        requestedProfileFields(body, request.method)
      );
    // Profile updates never write role or roleSource. Security state and event commit together.
    const user = await updateUserSecurityState(
      id,
      {
        status: active ? 'ACTIVE' : 'DISABLED',
        ...(revoke ? { tokenVersion: { increment: 1 } } : {}),
      },
      request.method === 'DELETE' ? {} : nextProfile,
      undefined,
      undefined,
      existing.tokenVersion,
      tx
    );
    await tx.scimIdentity.update({
      where: { id: identity.id },
      data: {
        lastSyncedAt: new Date(),
        ...(request.method === 'DELETE' ? { deletedAt: new Date() } : {}),
      },
    });
    // DELETE clears directory intent; rehire requires a fresh provider group sync.
    if (request.method === 'DELETE') {
      const memberships = await tx.scimGroupMembership.findMany({
        where: { userId: id, group: { connectorId: principal.connectorId } },
        select: { groupId: true },
      });
      const affected = await tx.scimGroupTeamBinding.findMany({
        where: {
          group: { connectorId: principal.connectorId, memberships: { some: { userId: id } } },
        },
        select: { teamId: true },
      });
      await tx.scimGroupMembership.deleteMany({
        where: { userId: id, group: { connectorId: principal.connectorId } },
      });
      if (memberships.length)
        await tx.scimGroup.updateMany({
          where: { id: { in: memberships.map(member => member.groupId) } },
          data: { updatedAt: new Date() },
        });
      for (const teamId of new Set(affected.map(binding => binding.teamId)))
        await reconcileTeam(tx, teamId);
    }
    const teamCount = !active ? await tx.teamMember.count({ where: { userId: id } }) : 0;
    const directEscalationRules = !active
      ? await tx.escalationRule.count({ where: { targetUserId: id } })
      : 0;
    const teamsWithoutActiveResponders = !active
      ? await tx.team.count({
          where: {
            members: {
              some: { userId: id },
              none: { user: { status: 'ACTIVE', role: { in: ['ADMIN', 'RESPONDER'] } } },
            },
          },
        })
      : 0;
    const shifts = !active
      ? await tx.onCallShift.count({ where: { userId: id, end: { gt: new Date() } } })
      : 0;
    await event(
      tx,
      principal,
      request.method === 'DELETE'
        ? 'user.deleted'
        : !active
          ? 'user.disabled'
          : existing.status === 'DISABLED'
            ? 'user.reactivated'
            : 'user.updated',
      id,
      {
        active,
        ordinaryAccessRevoked: revoke,
        operationalImpact: {
          teamCount,
          futureShifts: shifts,
          directEscalationRules,
          teamsWithoutActiveResponders,
          coverageReviewRequired:
            shifts > 0 || directEscalationRules > 0 || teamsWithoutActiveResponders > 0,
        },
        roleAuthority: existing.roleSource,
      }
    );
    return { user, externalId: identity.externalId };
  });
  invalidateSessionSecurityProjection(id);
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  return json(serializeScimUser({ ...updated.user, scimExternalId: updated.externalId }, origin));
}
