import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { enforceV2ResourceAuthorization } from '@/lib/api-v2/rbac';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';

export const teamMemberInput = z
  .object({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
    receiveTeamNotifications: z.boolean().optional(),
  })
  .strict();
export const teamLeadInput = z.object({ userId: z.string().cuid().nullable() }).strict();
export type TeamCommandActor = { id: string; apiKey?: { id: string; scopes: readonly string[] } };
export type TeamCommandOptions = { client?: Prisma.TransactionClient; expectedRevision?: number };
const conflict = (userMessage: string) => new AppError({ code: 'RESOURCE_CONFLICT', userMessage });
const missing = () =>
  new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Team or membership not found.' });

/** Always reload roles and membership from the transaction, including before receipt replay. */
export async function requireTeamAccess(
  tx: Prisma.TransactionClient,
  teamId: string,
  source: TeamCommandActor,
  write: boolean,
  administrativeRead = false
) {
  const [user, team] = await Promise.all([
    tx.user.findUnique({
      where: { id: source.id },
      select: {
        id: true,
        role: true,
        status: true,
        teamMemberships: { where: { teamId }, select: { teamId: true } },
      },
    }),
    tx.team.findUnique({ where: { id: teamId } }),
  ]);
  const identity = user ? authorizationActorFromUser(user) : null;
  if (!identity) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  if (!team) throw missing();
  const owner = await tx.teamMember.findFirst({
    where: { teamId, userId: source.id, role: 'OWNER' },
    select: { userId: true },
  });
  const actor: AuthorizationActor = {
    ...identity,
    ...(source.apiKey ? { apiKey: source.apiKey } : {}),
  };
  enforceV2ResourceAuthorization(
    actor,
    write
      ? AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE
      : administrativeRead
        ? AUTHORIZATION_ACTIONS.TEAM_ACTIVITY_READ
        : AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ,
    {
      type: 'team',
      teamId,
      ...(write || administrativeRead ? { ownerIds: owner ? [owner.userId] : [] } : {}),
    }
  );
  if (write && team.scimExternalId)
    throw conflict(
      'This team is managed by SCIM. Change its membership through the identity provider.'
    );
  return team;
}
async function retainActiveOwner(
  tx: Prisma.TransactionClient,
  member: { id: string; teamId: string; role: string }
) {
  if (member.role !== 'OWNER') return;
  if (
    !(await tx.teamMember.findFirst({
      where: {
        teamId: member.teamId,
        role: 'OWNER',
        id: { not: member.id },
        user: { status: 'ACTIVE' },
      },
      select: { id: true },
    }))
  )
    throw conflict('Each team must retain at least one active owner.');
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: TeamCommandActor,
  action: string,
  teamId: string,
  userId: string | null,
  details: Prisma.InputJsonObject
) {
  await logAudit(
    {
      action,
      entityType: userId ? 'TEAM_MEMBER' : 'TEAM',
      entityId: userId ? `${teamId}:${userId}` : teamId,
      actorId: actor.id,
      source: actor.apiKey ? 'API' : 'UI',
      details: {
        teamId,
        userId,
        ...details,
        ...(actor.apiKey ? { apiClientId: actor.apiKey.id } : {}),
      },
    },
    tx
  );
}
/** UI owns its transaction; REST joins the Serializable mutation/receipt transaction. */
async function run<T extends { userId: string | null }>(
  options: TeamCommandOptions,
  command: (tx: Prisma.TransactionClient) => Promise<T>
) {
  if (options.client) return command(options.client);
  const result = await runSerializableTransaction(command);
  if (result.userId) invalidateSessionSecurityProjection(result.userId);
  return result;
}
function checkRevision(revision: number, options: TeamCommandOptions) {
  if (options.expectedRevision !== undefined && revision !== options.expectedRevision)
    throw preconditionFailed();
}

export async function setTeamMembership(
  teamId: string,
  userId: string,
  input: z.input<typeof teamMemberInput>,
  actor: TeamCommandActor,
  options: TeamCommandOptions = {}
) {
  const body = teamMemberInput.parse(input);
  return run(options, async tx => {
    const team = await requireTeamAccess(tx, teamId, actor, true);
    checkRevision(team.revision, options);
    const target = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (target?.status !== 'ACTIVE')
      throw conflict('Operational assignments require an active user.');
    const previous = await tx.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    const notifications =
      body.receiveTeamNotifications ?? previous?.receiveTeamNotifications ?? true;
    if (previous?.role === body.role && previous.receiveTeamNotifications === notifications)
      return { teamId, userId, revision: team.revision, membership: previous };
    if (previous && body.role !== 'OWNER') await retainActiveOwner(tx, previous);
    // User before Team matches lifecycle writers. Serializable snapshots fence owner races.
    if (!previous || previous.role !== body.role)
      await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    const membership = await tx.teamMember.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { teamId, userId, role: body.role, receiveTeamNotifications: notifications },
      update: { role: body.role, receiveTeamNotifications: notifications },
    });
    await audit(
      tx,
      actor,
      !previous
        ? 'team.member.added'
        : previous.role !== body.role
          ? 'team.member.role.updated'
          : 'team.member.notifications.updated',
      teamId,
      userId,
      { role: body.role, receiveTeamNotifications: notifications }
    );
    if (!previous)
      await createInAppNotifications(
        {
          userIds: [userId],
          type: 'TEAM',
          title: 'Added to Team',
          message: `You were added to team "${team.name}" as ${body.role}`,
          entityType: 'TEAM',
          entityId: teamId,
          dedupeKey: `team-member-added:${membership.id}`,
        },
        tx
      );
    const updated = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { revision: true },
    });
    return { teamId, userId, revision: updated.revision, membership };
  });
}
export async function deleteTeamMembership(
  teamId: string,
  userId: string,
  actor: TeamCommandActor,
  options: TeamCommandOptions = {}
) {
  return run(options, async tx => {
    const team = await requireTeamAccess(tx, teamId, actor, true);
    checkRevision(team.revision, options);
    const member = await tx.teamMember.findUnique({ where: { userId_teamId: { userId, teamId } } });
    if (!member) return { teamId, userId, revision: team.revision, membership: null };
    await retainActiveOwner(tx, member);
    await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    await tx.teamMember.delete({ where: { id: member.id } });
    await tx.team.updateMany({
      where: { id: teamId, teamLeadId: userId },
      data: { teamLeadId: null },
    });
    await audit(tx, actor, 'team.member.removed', teamId, userId, {});
    await createInAppNotifications(
      {
        userIds: [userId],
        type: 'TEAM',
        title: 'Removed from Team',
        message: `You were removed from team "${team.name}"`,
        entityType: 'TEAM',
        entityId: teamId,
        dedupeKey: `team-member-removed:${member.id}`,
      },
      tx
    );
    const updated = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { revision: true },
    });
    return { teamId, userId, revision: updated.revision, membership: null };
  });
}
export async function setTeamLead(
  teamId: string,
  input: z.input<typeof teamLeadInput>,
  actor: TeamCommandActor,
  options: TeamCommandOptions = {}
) {
  const { userId } = teamLeadInput.parse(input);
  return run(options, async tx => {
    const team = await requireTeamAccess(tx, teamId, actor, true);
    checkRevision(team.revision, options);
    if (
      userId &&
      !(await tx.teamMember.findFirst({
        where: { teamId, userId, user: { status: 'ACTIVE' } },
        select: { id: true },
      }))
    )
      throw conflict('Team lead must be an active member of this team.');
    if (team.teamLeadId === userId)
      return { teamId, userId, revision: team.revision, teamLeadId: userId };
    const updated = await tx.team.update({ where: { id: teamId }, data: { teamLeadId: userId } });
    await audit(tx, actor, 'team.lead_updated', teamId, null, { teamLeadId: userId });
    return { teamId, userId, revision: updated.revision, teamLeadId: userId };
  });
}
/** Membership-id adapters are UI-only; authorization is repeated in the shared transaction. */
export async function requireMembershipCoordinates(memberId: string) {
  const member = await prisma.teamMember.findUnique({
    where: { id: z.string().cuid().parse(memberId) },
  });
  if (!member) throw missing();
  return member;
}

export async function patchTeamMembership(
  memberId: string,
  input: Partial<z.input<typeof teamMemberInput>>,
  actor: TeamCommandActor
) {
  const body = teamMemberInput.partial().strict().parse(input);
  const result = await runSerializableTransaction(async tx => {
    const member = await tx.teamMember.findUnique({
      where: { id: z.string().cuid().parse(memberId) },
    });
    if (!member) throw missing();
    return setTeamMembership(
      member.teamId,
      member.userId,
      { role: body.role ?? member.role, receiveTeamNotifications: body.receiveTeamNotifications },
      actor,
      { client: tx }
    );
  });
  invalidateSessionSecurityProjection(result.userId);
  return result;
}
