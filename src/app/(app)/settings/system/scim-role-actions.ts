'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { getControlActor, lockControlActor } from '@/lib/auth-control/actor';
import { runSerializableTransaction } from '@/lib/db-utils';
import { invalidateSessionSecurityProjections } from '@/lib/session-security-projection';
import { adminFailure } from '@/lib/scim/security/admin-errors';
import {
  planScimRoles,
  reconcileScimRoles,
  summarizeScimRoleChanges,
} from '@/lib/scim/lifecycle/roles';

const selection = z
  .object({
    connectorId: z.string().min(1).max(128),
    groupId: z.string().min(1).max(128),
  })
  .strict();
const mapping = selection.extend({
  role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']).nullable(),
});
type Mapping = z.infer<typeof mapping>;

export async function getScimRoleMappingAction(input: unknown) {
  try {
    await assertAdmin();
    const { connectorId, groupId } = selection.parse(input);
    return await prisma.scimGroup.findFirstOrThrow({
      where: { id: groupId, connectorId },
      select: { name: true, systemRole: true },
    });
  } catch (error) {
    return adminFailure(error);
  }
}

async function preview(tx: Prisma.TransactionClient, input: Mapping) {
  const group = await tx.scimGroup.findFirstOrThrow({
    where: { id: input.groupId, connectorId: input.connectorId },
    select: {
      id: true,
      name: true,
      systemRole: true,
      updatedAt: true,
      memberships: { select: { userId: true }, orderBy: { userId: 'asc' }, take: 10001 },
    },
  });
  if (group.memberships.length > 10000)
    throw new Error(
      'Administrator role mapping supports up to 10,000 group members. Split this group first.'
    );
  const plan = await planScimRoles(
    tx,
    input.connectorId,
    group.memberships.map(member => member.userId),
    { groupId: group.id, role: input.role }
  );
  return {
    group: group.name,
    currentRole: group.systemRole,
    role: input.role,
    members: group.memberships.length,
    ...summarizeScimRoleChanges(plan.changes),
    revision: createHash('sha256').update(JSON.stringify({ group, input, plan })).digest('hex'),
  };
}

export async function previewScimRoleMappingAction(input: unknown) {
  try {
    await assertAdmin();
    const values = mapping.parse(input);
    return await prisma.$transaction(tx => preview(tx, values), {
      isolationLevel: 'RepeatableRead',
      timeout: 30000,
    });
  } catch (error) {
    return adminFailure(error);
  }
}

export async function saveScimRoleMappingAction(input: unknown) {
  try {
    const { revision, ...values } = mapping
      .extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(input);
    const actor = await getControlActor(true);
    if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
    const changed = await runSerializableTransaction(async tx => {
      await lockControlActor(tx, actor);
      const impact = await preview(tx, values);
      if (impact.revision !== revision)
        throw new Error(
          'Membership or operational impact changed. Preview the role mapping again.'
        );
      await tx.scimGroup.update({
        where: { id: values.groupId },
        data: { systemRole: values.role },
      });
      const members = await tx.scimGroupMembership.findMany({
        where: { groupId: values.groupId },
        select: { userId: true },
      });
      const requestId = crypto.randomUUID();
      const changedIds = await reconcileScimRoles(
        tx,
        values.connectorId,
        members.map(member => member.userId),
        requestId,
        actor.id
      );
      if (changedIds.length !== impact.changedUsers)
        throw new Error(
          'Membership or operational impact changed. Preview the role mapping again.'
        );
      await tx.scimEvent.create({
        data: {
          connectorId: values.connectorId,
          action: 'role.mapping.updated',
          resourceId: values.groupId,
          requestId,
          details: { actorId: actor.id, ...impact },
        },
      });
      return changedIds;
    });
    invalidateSessionSecurityProjections(changed);
    return { changedUsers: changed.length };
  } catch (error) {
    return adminFailure(error);
  }
}
