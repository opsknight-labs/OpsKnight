import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { createRunbookSecretSchema, updateRunbookSecretSchema } from './schemas';
import { collectSecretReferences, extractSecretName, isSecretReference } from './definition';
import { RunbookSecretNotFoundError } from './errors';

export async function createRunbookSecret(raw: unknown, actorId: string) {
  const input = createRunbookSecretSchema.parse(raw);
  const valueEncrypted = await encrypt(input.value);
  return prisma.$transaction(async tx => {
    const secret = await tx.runbookSecret.create({
      data: {
        name: input.name,
        description: input.description,
        valueEncrypted,
        createdById: actorId,
      },
    });
    await logAudit(
      {
        action: 'runbook.secret.created',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId,
        details: { name: secret.name },
      },
      tx
    );
    return { id: secret.id, name: secret.name, description: secret.description };
  });
}

export async function createRunbookSecretWithGrant(
  raw: unknown,
  target: { agentId?: string; agentPoolId?: string },
  actorId: string
) {
  if (Boolean(target.agentId) === Boolean(target.agentPoolId)) {
    throw new Error('Select exactly one Agent or Agent pool for a secret grant.');
  }
  const input = createRunbookSecretSchema.parse(raw);
  const valueEncrypted = await encrypt(input.value);
  return prisma.$transaction(async tx => {
    const secret = await tx.runbookSecret.create({
      data: {
        name: input.name,
        description: input.description,
        valueEncrypted,
        createdById: actorId,
      },
    });
    await tx.runbookSecretGrant.create({
      data: {
        secretId: secret.id,
        agentId: target.agentId,
        agentPoolId: target.agentPoolId,
      },
    });
    await logAudit(
      {
        action: 'runbook.secret.created',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId,
        details: {
          name: secret.name,
          initialAgentId: target.agentId ?? null,
          initialAgentPoolId: target.agentPoolId ?? null,
        },
      },
      tx
    );
    return { id: secret.id, name: secret.name, description: secret.description };
  });
}

export async function rotateRunbookSecret(secretId: string, raw: unknown, actorId: string) {
  const input = updateRunbookSecretSchema.parse(raw);
  const valueEncrypted = input.value === undefined ? undefined : await encrypt(input.value);
  return prisma.$transaction(async tx => {
    const secret = await tx.runbookSecret.update({
      where: { id: secretId },
      data: { description: input.description, valueEncrypted },
    });
    await logAudit(
      {
        action: 'runbook.secret.rotated',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId,
        details: { name: secret.name, valueRotated: valueEncrypted !== undefined },
      },
      tx
    );
    return { id: secret.id, name: secret.name, description: secret.description };
  });
}

export async function grantRunbookSecret(
  secretId: string,
  target: { agentId?: string; agentPoolId?: string },
  actorId: string
) {
  if (Boolean(target.agentId) === Boolean(target.agentPoolId)) {
    throw new Error('Select exactly one Agent or Agent pool for a secret grant.');
  }
  return prisma.$transaction(async tx => {
    const grant = target.agentId
      ? await tx.runbookSecretGrant.upsert({
          where: { secretId_agentId: { secretId, agentId: target.agentId } },
          create: { secretId, agentId: target.agentId },
          update: {},
        })
      : await tx.runbookSecretGrant.upsert({
          where: {
            secretId_agentPoolId: { secretId, agentPoolId: target.agentPoolId! },
          },
          create: { secretId, agentPoolId: target.agentPoolId! },
          update: {},
        });
    await logAudit(
      {
        action: 'runbook.secret.granted',
        entityType: 'RUNBOOK_SECRET',
        entityId: secretId,
        actorId,
        details: { agentId: target.agentId ?? null, agentPoolId: target.agentPoolId ?? null },
      },
      tx
    );
    return grant;
  });
}

export async function revokeRunbookSecretGrant(grantId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const grant = await tx.runbookSecretGrant.delete({ where: { id: grantId } });
    await logAudit(
      {
        action: 'runbook.secret.grant.revoked',
        entityType: 'RUNBOOK_SECRET',
        entityId: grant.secretId,
        actorId,
        details: { grantId },
      },
      tx
    );
    return grant;
  });
}

export async function resolveSecretInputValues(
  values: Record<string, unknown>,
  scope: { agentId: string; targetAgentPoolId?: string | null },
  tx: Prisma.TransactionClient = prisma
) {
  const names = [...collectSecretReferences(values)];
  if (names.length === 0) return values;
  const records = await tx.runbookSecret.findMany({
    where: {
      name: { in: names },
      grants: {
        some: {
          OR: [
            { agentId: scope.agentId },
            ...(scope.targetAgentPoolId ? [{ agentPoolId: scope.targetAgentPoolId }] : []),
          ],
        },
      },
    },
  });
  const byName = new Map(records.map(record => [record.name, record.valueEncrypted]));
  const resolvedEntries = await Promise.all(
    Object.entries(values).map(async ([key, value]) => {
      if (!isSecretReference(value)) {
        return [key, value] as const;
      }
      const name = extractSecretName(value);
      const encrypted = byName.get(name);
      if (!encrypted) {
        throw new RunbookSecretNotFoundError(
          `${name} (not granted to this Agent or execution pool)`
        );
      }
      return [key, await decrypt(encrypted)] as const;
    })
  );
  return Object.fromEntries(resolvedEntries);
}
