'use server';

import { z } from 'zod';
import { adminFailure } from '@/lib/scim/security/admin-errors';
import prisma from '@/lib/prisma';
import { getScimConfig } from '@/lib/scim';
import { invalidateSessionSecurityProjections } from '@/lib/session-security-projection';
import { assertAdmin } from '@/lib/rbac';
import { getControlActor, lockControlActor } from '@/lib/auth-control/actor';
import { runSerializableTransaction } from '@/lib/db-utils';
import { createCredential, revokeCredential, scopes } from '@/lib/scim/security/credentials';
import { reconcileTeam } from '@/lib/scim/lifecycle/membership';

const idSchema = z.string().min(1).max(128);
const connectorSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(100),
    provider: z.enum(['ENTRA', 'OKTA', 'GENERIC']),
    enabled: z.boolean(),
    tenantId: z.string().uuid().nullable(),
    oidcIssuer: z.string().url().nullable(),
    oidcClientId: z.string().trim().min(1).max(320).nullable(),
    trustedLinkEnabled: z.boolean(),
    profileFields: z.array(z.enum(['name', 'email', 'title', 'department', 'photos'])).max(5),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.trustedLinkEnabled &&
      (input.provider !== 'ENTRA' ||
        !input.tenantId ||
        !input.oidcClientId ||
        input.oidcIssuer !== `https://login.microsoftonline.com/${input.tenantId}/v2.0`)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Trusted linking requires an Entra tenant, matching tenant issuer and exact registered client ID.',
      });
  });
const credentialSchema = z
  .object({
    connectorId: idSchema,
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.enum(scopes)).min(1).max(4),
    lifetimeDays: z.number().int().min(1).max(365),
    overlapMinutes: z.number().int().min(0).max(1440),
    acknowledgeLegacyCutover: z.boolean().default(false),
  })
  .strict();
const pageSchema = z
  .object({
    connectorId: idSchema,
    tab: z.enum(['users', 'groups', 'activity']),
    query: z.string().trim().max(100),
    page: z.number().int().min(1).max(1000000),
  })
  .strict();

export async function scimOverviewAction() {
  try {
    await assertAdmin();
    const connectors = await prisma.scimConnector.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        _count: { select: { identities: true, groups: true } },
        credentials: {
          select: {
            id: true,
            name: true,
            scopes: true,
            tokenHint: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
            lastUsedAt: true,
            generation: true,
            createdBy: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    const { legacyCredentialSource } = await getScimConfig();
    const summaries = connectors.map(connector => ({
      ...connector,
      legacyCredentialSource: connector.id === 'legacy' ? legacyCredentialSource : null,
    }));
    return JSON.parse(JSON.stringify(summaries)) as Array<
      Omit<(typeof connectors)[number], 'createdAt' | 'updatedAt' | 'credentials'> & {
        legacyCredentialSource: 'DATABASE' | 'ENV' | null;
        createdAt: string;
        updatedAt: string;
        credentials: Array<
          Omit<
            (typeof connectors)[number]['credentials'][number],
            'createdAt' | 'expiresAt' | 'revokedAt' | 'lastUsedAt'
          > & {
            createdAt: string;
            expiresAt: string;
            revokedAt: string | null;
            lastUsedAt: string | null;
          }
        >;
      }
    >;
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function scimDirectoryAction(input: unknown) {
  try {
    await assertAdmin();
    const { connectorId, tab, query, page } = pageSchema.parse(input);
    const skip = (page - 1) * 25;
    if (tab === 'users') {
      const where = {
        connectorId,
        ...(query
          ? {
              OR: [
                { externalId: { contains: query, mode: 'insensitive' as const } },
                { user: { email: { contains: query, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.scimIdentity.findMany({
          where,
          skip,
          take: 25,
          orderBy: { userId: 'asc' },
          include: {
            user: {
              select: { email: true, name: true, status: true, roleSource: true, role: true },
            },
          },
        }),
        prisma.scimIdentity.count({ where }),
      ]);
      return {
        total,
        rows: rows.map(r => ({
          id: r.userId,
          label: r.user.email,
          detail: `${r.deletedAt ? 'DELETED' : r.user.status} · ${r.user.role} (${r.user.roleSource}) · ${r.externalId}`,
          time: r.lastSyncedAt.toISOString(),
        })),
      };
    }
    if (tab === 'groups') {
      const where = {
        connectorId,
        ...(query ? { name: { contains: query, mode: 'insensitive' as const } } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.scimGroup.findMany({
          where,
          skip,
          take: 25,
          orderBy: { id: 'asc' },
          include: {
            bindings: { include: { team: { select: { name: true } } } },
            _count: { select: { memberships: true } },
          },
        }),
        prisma.scimGroup.count({ where }),
      ]);
      return {
        total,
        rows: rows.map(r => ({
          id: r.id,
          label: r.name,
          detail: `${r._count.memberships} directory members · ${r.bindings.length ? r.bindings.map(b => b.team.name).join(', ') : 'No team binding'} · ${r.scimExternalId ?? 'No external ID'}`,
          time: r.updatedAt.toISOString(),
        })),
      };
    }
    const where = {
      connectorId,
      ...(query ? { action: { contains: query, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.scimEvent.findMany({
        where,
        skip,
        take: 25,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.scimEvent.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(r => ({
        id: r.id,
        label: r.action,
        detail: `${r.resourceId ?? ''} · Request ${r.requestId} · ${JSON.stringify(r.details)}`,
        time: r.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function saveScimConnectorAction(input: unknown) {
  try {
    const data = connectorSchema.parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    return await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const { id, ...values } = data;
      const connector = id
        ? await tx.scimConnector.update({ where: { id }, data: values })
        : await tx.scimConnector.create({ data: values });
      await tx.scimEvent.create({
        data: {
          connectorId: connector.id,
          action: id ? 'connector.updated' : 'connector.created',
          requestId: crypto.randomUUID(),
          details: {
            actorId: actor.id,
            trustedLinkEnabled: data.trustedLinkEnabled,
            enabled: data.enabled,
          },
        },
      });
      return { id: connector.id };
    });
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function createScimCredentialAction(input: unknown) {
  try {
    return await createCredential(credentialSchema.parse(input));
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function revokeScimCredentialAction(input: unknown) {
  try {
    return await revokeCredential(idSchema.parse(input));
  } catch (error) {
    return await adminFailure(error);
  }
}

const bindingSchema = z
  .object({
    groupId: idSchema,
    teamId: idSchema,
    adoptMemberIds: z.array(idSchema).max(10000).default([]),
  })
  .strict();
async function preview(
  tx: Pick<typeof prisma, 'scimGroup' | 'team' | 'teamMember' | 'service' | 'escalationRule'>,
  groupId: string,
  teamId: string,
  adoptMemberIds: string[] = []
) {
  const [group, team, members, services, escalations] = await Promise.all([
    tx.scimGroup.findUniqueOrThrow({ where: { id: groupId }, include: { memberships: true } }),
    tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { name: true, scimExternalId: true },
    }),
    tx.teamMember.findMany({
      where: { teamId },
      select: { id: true, userId: true, role: true, scimGrant: true },
    }),
    tx.service.count({ where: { teamId } }),
    tx.escalationRule.count({ where: { targetTeamId: teamId } }),
  ]);
  const directoryUsers = new Set(group.memberships.map(member => member.userId));
  const legacyMatch =
    group.connectorId === 'legacy' &&
    group.id === teamId &&
    group.scimExternalId !== null &&
    group.scimExternalId === team.scimExternalId;
  const candidates = legacyMatch
    ? members.filter(
        member => member.role === 'MEMBER' && !member.scimGrant && directoryUsers.has(member.userId)
      )
    : [];
  const approved = new Set(adoptMemberIds);
  if (adoptMemberIds.some(id => !candidates.some(member => member.id === id)))
    throw new Error(
      'Membership or operational impact changed. Select only eligible legacy members.'
    );
  const existing = new Set(members.map(m => m.userId));
  const state = {
    group: group.name,
    team: team.name,
    additions: group.memberships.filter(m => !existing.has(m.userId)).length,
    protectedOwners: members.filter(m => m.role === 'OWNER').length,
    services,
    escalations,
    removals: 0,
    adoptedMemberships: approved.size,
    legacyCandidates: candidates.map(member => ({ id: member.id, userId: member.userId })),
    retainedManualMemberships: members.filter(
      member => !member.scimGrant && !approved.has(member.id)
    ).length,
  };
  // Approval pins exactly the previewed membership and operational associations.
  const { createHash } = await import('node:crypto');
  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        state,
        adoptedMemberIds: [...approved].sort(),
        users: group.memberships.map(m => m.userId).sort(),
        members: members
          .map(m => `${m.id}:${m.userId}:${m.role}:${m.scimGrant?.bindingId ?? 'manual'}`)
          .sort(),
      })
    )
    .digest('hex');
  return { ...state, revision };
}
export async function previewScimBindingAction(input: unknown) {
  try {
    await assertAdmin();
    const { groupId, teamId, adoptMemberIds } = bindingSchema.parse(input);
    return await preview(prisma, groupId, teamId, adoptMemberIds);
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function approveScimBindingAction(input: unknown) {
  try {
    const { groupId, teamId, revision, adoptMemberIds } = bindingSchema
      .extend({ revision: z.string().length(64) })
      .parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    const changedUserIds = await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const impact = await preview(tx, groupId, teamId, adoptMemberIds);
      if (impact.revision !== revision)
        throw new Error(
          'Membership or operational impact changed. Preview again before approving.'
        );
      const group = await tx.scimGroup.findUniqueOrThrow({ where: { id: groupId } });
      const binding = await tx.scimGroupTeamBinding.upsert({
        where: { groupId_teamId: { groupId, teamId } },
        create: { groupId, teamId, approvedBy: actor.id },
        update: {},
      });
      if (adoptMemberIds.length) {
        const members = await tx.teamMember.findMany({
          where: { id: { in: adoptMemberIds }, teamId, role: 'MEMBER', scimGrant: null },
        });
        if (members.length !== adoptMemberIds.length)
          throw new Error('Membership or operational impact changed. Preview again.');
        await tx.scimTeamGrant.createMany({
          data: members.map(member => ({
            bindingId: binding.id,
            userId: member.userId,
            teamMemberId: member.id,
          })),
        });
      }
      const reconciliation = await reconcileTeam(tx, teamId);
      await tx.scimEvent.create({
        data: {
          connectorId: group.connectorId,
          action: 'binding.approved',
          resourceId: groupId,
          requestId: crypto.randomUUID(),
          details: { actorId: actor.id, teamId, ...impact },
        },
      });
      return reconciliation.changedUserIds;
    });
    invalidateSessionSecurityProjections(changedUserIds);
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function detachScimBindingAction(input: unknown) {
  try {
    const { groupId, teamId } = bindingSchema.parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    const changedUserIds = await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const group = await tx.scimGroup.findUniqueOrThrow({ where: { id: groupId } });
      const binding = await tx.scimGroupTeamBinding.findUniqueOrThrow({
        where: { groupId_teamId: { groupId, teamId } },
      });
      const reconciliation = await reconcileTeam(tx, teamId, [binding.id]);
      await tx.scimGroupTeamBinding.delete({ where: { id: binding.id } });
      await tx.scimEvent.create({
        data: {
          connectorId: group.connectorId,
          action: 'binding.detached',
          resourceId: groupId,
          requestId: crypto.randomUUID(),
          details: {
            actorId: actor.id,
            teamId,
            policy: 'REVOKE_DIRECTORY_GRANTS',
            revokedMemberships: reconciliation.revokedMemberships,
            transferredGrants: reconciliation.transferredGrants,
            coverageReviewRequired: reconciliation.revokedMemberships > 0,
          },
        },
      });
      return reconciliation.changedUserIds;
    });
    invalidateSessionSecurityProjections(changedUserIds);
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function restoreScimIdentityAction(input: unknown) {
  try {
    const { id } = z.object({ id: idSchema }).strict().parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const identity = await tx.scimIdentity.update({
        where: { userId: id },
        data: { deletedAt: null },
      });
      await tx.scimEvent.create({
        data: {
          connectorId: identity.connectorId,
          action: 'user.restoration.approved',
          resourceId: id,
          requestId: crypto.randomUUID(),
          details: { actorId: actor.id, remainsDisabledUntilProviderReactivation: true },
        },
      });
    });
  } catch (error) {
    return await adminFailure(error);
  }
}
export async function scimTeamsAction(query: unknown) {
  try {
    await assertAdmin();
    const search = z.string().max(100).parse(query);
    return await prisma.team.findMany({
      where: { name: { contains: search, mode: 'insensitive' } },
      select: { id: true, name: true },
      take: 25,
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    return await adminFailure(error);
  }
}

/** Explicitly adopt an existing account; directory email collisions never authorize adoption. */
export async function bindExistingScimUserAction(input: unknown) {
  try {
    const { connectorId, externalId, userId } = z
      .object({
        connectorId: idSchema,
        externalId: z.string().trim().min(1).max(320),
        userId: idSchema,
      })
      .strict()
      .parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const collisions = await tx.$queryRaw<{ userId: string }[]>`
        SELECT identity."userId" FROM "ScimIdentity" identity
        JOIN "User" account ON account.id = identity."userId"
        WHERE identity."connectorId" = ${connectorId} AND lower(account.email) = lower(${user.email}) LIMIT 1`;
      if (collisions.length)
        throw new Error(
          'Administrator binding conflicts with an existing case-insensitive directory userName. Review the existing identity.'
        );
      await tx.scimIdentity.create({ data: { connectorId, externalId, userId } });
      await tx.scimEvent.create({
        data: {
          connectorId,
          action: 'user.binding.approved',
          resourceId: userId,
          requestId: crypto.randomUUID(),
          details: {
            actorId: actor.id,
            roleAuthorityPreserved: user.roleSource,
            statusPreserved: user.status,
          },
        },
      });
    });
  } catch (error) {
    return await adminFailure(error);
  }
}

/** Compare local directory intent with operational membership; never invent provider state. */
export async function scimDriftAction(input: unknown) {
  try {
    await assertAdmin();
    const { connectorId, page } = z
      .object({ connectorId: idSchema, page: z.number().int().min(1).max(1000000) })
      .strict()
      .parse(input);
    return await prisma.$queryRaw<
      {
        groupId: string;
        teamId: string;
        group: string;
        team: string;
        missingMembers: number;
        unexpectedDirectoryGrants: number;
        independentManualMembers: number;
      }[]
    >`
      WITH page AS MATERIALIZED (
        SELECT binding.id, binding."groupId", binding."teamId", directory.name AS "group", team.name AS team
        FROM "ScimGroupTeamBinding" binding
        JOIN "ScimGroup" directory ON directory.id = binding."groupId"
        JOIN "Team" team ON team.id = binding."teamId"
        WHERE directory."connectorId" = ${connectorId}
        ORDER BY binding.id LIMIT 25 OFFSET ${(page - 1) * 25}
      ), team_stats AS (
        SELECT selected."teamId",
          count(*) FILTER (WHERE grant_row."teamMemberId" IS NULL)::integer AS manual,
          count(*) FILTER (WHERE grant_row."teamMemberId" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "ScimGroupTeamBinding" desired_binding
            JOIN "ScimGroupMembership" desired ON desired."groupId" = desired_binding."groupId"
            WHERE desired_binding."teamId" = selected."teamId" AND desired."userId" = member."userId"
          ))::integer AS unexpected
        FROM (SELECT DISTINCT "teamId" FROM page) selected
        JOIN "TeamMember" member ON member."teamId" = selected."teamId"
        LEFT JOIN "ScimTeamGrant" grant_row ON grant_row."teamMemberId" = member.id
        GROUP BY selected."teamId"
      )
      SELECT page."groupId", page."teamId", page."group", page.team,
        (SELECT count(*)::integer FROM "ScimGroupMembership" desired
          WHERE desired."groupId" = page."groupId" AND NOT EXISTS (
            SELECT 1 FROM "TeamMember" actual
            WHERE actual."teamId" = page."teamId" AND actual."userId" = desired."userId"
          )) AS "missingMembers",
        coalesce(team_stats.unexpected, 0)::integer AS "unexpectedDirectoryGrants",
        coalesce(team_stats.manual, 0)::integer AS "independentManualMembers"
      FROM page LEFT JOIN team_stats ON team_stats."teamId" = page."teamId"
      ORDER BY page.id`;
  } catch (error) {
    return await adminFailure(error);
  }
}
