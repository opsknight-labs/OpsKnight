import 'server-only';
import { Prisma, type RunbookSecret } from '@prisma/client';
import { z } from 'zod';
import { decrypt, encrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import { createRunbookSecretSchema, updateRunbookSecretSchema } from './schemas';
import { collectSecretReferences, extractSecretName, isSecretReference } from './definition';
import { RunbookSecretNotFoundError } from './errors';
import { lockFleetConfiguration } from './pool-labels';
import {
  runRunbookCommand,
  logRunbookCommandAudit,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';
export const secretGrantTargetSchema = z
  .object({ agentId: z.string().cuid().optional(), agentPoolId: z.string().cuid().optional() })
  .strict()
  .refine(
    target => Boolean(target.agentId) !== Boolean(target.agentPoolId),
    'Select exactly one Agent or Agent pool.'
  );
type SecretTarget = z.infer<typeof secretGrantTargetSchema>;
export type SecretCommandOptions = {
  client?: RunbookCommandClient;
  expectedRevision?: number;
  secretId?: string;
};
const commandActorId = (actor: RunbookCommandActor) =>
  typeof actor === 'string' ? actor : actor.id;
export const runbookSecretMetadataSelect = {
  id: true,
  name: true,
  description: true,
  revision: true,
  lastRotatedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} satisfies Prisma.RunbookSecretSelect;
export function projectRunbookSecret(secret: Omit<RunbookSecret, 'valueEncrypted'>) {
  return {
    id: secret.id,
    name: secret.name,
    reference: `secret://${secret.name}`,
    description: secret.description,
    revision: secret.revision,
    lastRotatedAt: secret.lastRotatedAt,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}
export async function lockRunbookSecret(
  tx: Prisma.TransactionClient,
  secretId: string,
  expectedRevision?: number
) {
  await tx.$queryRaw`SELECT id FROM "RunbookSecret" WHERE id = ${secretId} FOR UPDATE`;
  const secret = await tx.runbookSecret.findUnique({ where: { id: secretId } });
  if (!secret)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Runbook secret not found.' });
  if (expectedRevision !== undefined && secret.revision !== expectedRevision)
    throw preconditionFailed();
  return secret;
}
async function requireSecretGrantTarget(tx: Prisma.TransactionClient, target: SecretTarget) {
  if (target.agentId) {
    await tx.$queryRaw`SELECT id FROM "RunbookAgent" WHERE id = ${target.agentId} FOR SHARE`;
    const agent = await tx.runbookAgent.findUnique({
      where: { id: target.agentId },
      select: { status: true },
    });
    if (!agent) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent not found.' });
    if (agent.status === 'REVOKED')
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'A revoked Agent cannot receive secret grants.',
      });
  } else {
    await tx.$queryRaw`SELECT id FROM "RunbookAgentPool" WHERE id = ${target.agentPoolId!} FOR SHARE`;
    const pool = await tx.runbookAgentPool.findUnique({
      where: { id: target.agentPoolId! },
      select: { lifecycle: true },
    });
    if (pool?.lifecycle === 'RETIRED')
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Retired pools cannot receive secret grants.',
      });
    if (!pool)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent pool not found.' });
  }
}
export async function createRunbookSecret(
  raw: unknown,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const input = createRunbookSecretSchema.parse(raw);
  const valueEncrypted = await encrypt(input.value);
  return runRunbookCommand(client, async tx => {
    const secret = await tx.runbookSecret.create({
      data: {
        name: input.name,
        description: input.description,
        valueEncrypted,
        createdById: commandActorId(actor),
      },
    });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.secret.created',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId: commandActorId(actor),
        details: { name: secret.name },
      },
      tx
    );
    return projectRunbookSecret(secret);
  });
}
export async function createRunbookSecretWithGrant(
  raw: unknown,
  rawTarget: SecretTarget,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const input = createRunbookSecretSchema.parse(raw);
  const target = secretGrantTargetSchema.parse(rawTarget);
  const valueEncrypted = await encrypt(input.value);
  return runRunbookCommand(client, async tx => {
    await lockFleetConfiguration(tx);
    await requireSecretGrantTarget(tx, target);
    const secret = await tx.runbookSecret.create({
      data: {
        name: input.name,
        description: input.description,
        valueEncrypted,
        createdById: commandActorId(actor),
      },
    });
    await tx.runbookSecretGrant.create({ data: { secretId: secret.id, ...target } });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.secret.created',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId: commandActorId(actor),
        details: {
          name: secret.name,
          initialAgentId: target.agentId ?? null,
          initialAgentPoolId: target.agentPoolId ?? null,
        },
      },
      tx
    );
    return projectRunbookSecret(
      await tx.runbookSecret.findUniqueOrThrow({ where: { id: secret.id } })
    );
  });
}
export async function rotateRunbookSecret(
  secretId: string,
  raw: unknown,
  actor: RunbookCommandActor,
  options: SecretCommandOptions = {}
) {
  const input = updateRunbookSecretSchema.parse(raw);
  const valueEncrypted = input.value === undefined ? undefined : await encrypt(input.value);
  return runRunbookCommand(options.client, async tx => {
    await lockRunbookSecret(tx, secretId, options.expectedRevision);
    const secret = await tx.runbookSecret.update({
      where: { id: secretId },
      data: { description: input.description, valueEncrypted },
    });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.secret.rotated',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId: commandActorId(actor),
        details: { name: secret.name, valueRotated: valueEncrypted !== undefined },
      },
      tx
    );
    return projectRunbookSecret(secret);
  });
}
export async function grantRunbookSecret(
  secretId: string,
  rawTarget: SecretTarget,
  actor: RunbookCommandActor,
  options: SecretCommandOptions = {}
) {
  const target = secretGrantTargetSchema.parse(rawTarget);
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    await requireSecretGrantTarget(tx, target);
    await lockRunbookSecret(tx, secretId, options.expectedRevision);
    const where = target.agentId
      ? { secretId_agentId: { secretId, agentId: target.agentId } }
      : { secretId_agentPoolId: { secretId, agentPoolId: target.agentPoolId! } };
    const existing = await tx.runbookSecretGrant.findUnique({ where });
    if (existing) return existing;
    const grant = await tx.runbookSecretGrant.create({ data: { secretId, ...target } });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.secret.granted',
        entityType: 'RUNBOOK_SECRET',
        entityId: secretId,
        actorId: commandActorId(actor),
        details: { agentId: target.agentId ?? null, agentPoolId: target.agentPoolId ?? null },
      },
      tx
    );
    return grant;
  });
}
export async function revokeRunbookSecretGrant(
  grantId: string,
  actor: RunbookCommandActor,
  options: SecretCommandOptions = {}
) {
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const existing = await tx.runbookSecretGrant.findUnique({ where: { id: grantId } });
    if (!existing || (options.secretId !== undefined && existing.secretId !== options.secretId))
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Secret grant not found.' });
    await lockRunbookSecret(tx, existing.secretId, options.expectedRevision);
    const grant = await tx.runbookSecretGrant.delete({ where: { id: grantId } });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.secret.grant.revoked',
        entityType: 'RUNBOOK_SECRET',
        entityId: grant.secretId,
        actorId: commandActorId(actor),
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
  tx: Prisma.TransactionClient
) {
  const names = [...collectSecretReferences(values)];
  if (names.length === 0) return values;
  // Grant deletion and value rotation hold the same parent row exclusively.
  // Resolve only after their commit, or finish this accepted claim before they commit.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "RunbookSecret"
    WHERE name IN (${Prisma.join(names)}) ORDER BY id FOR SHARE`);

  const records = await tx.runbookSecret.findMany({
    where: {
      name: { in: names },
      grants: {
        some: {
          OR: [
            { agentId: scope.agentId },
            ...(scope.targetAgentPoolId
              ? [
                  {
                    agentPoolId: scope.targetAgentPoolId,
                    agentPool: { members: { some: { agentId: scope.agentId } } },
                  },
                ]
              : []),
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
