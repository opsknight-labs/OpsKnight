import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import {
  schedulingLabelsSchema,
  lockFleetConfiguration,
  synchronizeLabelMemberships,
  synchronizeAgentLabelMemberships,
} from './pool-labels';
import { createRunbookAgentPoolSchema } from './schemas';
import {
  runRunbookCommand,
  logRunbookCommandAudit,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';

export const updateRunbookAgentPoolSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000),
    mode: z.enum(['LOCAL_HOSTS', 'SHARED_TARGET']),
    matchLabels: schedulingLabelsSchema,
  })
  .partial()
  .strict()
  .refine(input => Object.keys(input).length > 0, 'At least one field is required.');
export const updateRunbookAgentMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    labels: schedulingLabelsSchema.optional(),
  })
  .strict()
  .refine(input => Object.keys(input).length > 0, 'At least one field is required.');
export type FleetMutationOptions = {
  client?: RunbookCommandClient;
  expectedRevision?: number;
  allowSecretScopeExpansion?: boolean;
};
const actorId = (actor: RunbookCommandActor) => (typeof actor === 'string' ? actor : actor.id);
const notFound = () =>
  new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent or pool not found.' });
const conflict = (message: string) =>
  new AppError({ code: 'RESOURCE_CONFLICT', userMessage: message });
const stableLabels = (labels: unknown) =>
  JSON.stringify(
    Object.entries(schedulingLabelsSchema.parse(labels)).sort(([a], [b]) => a.localeCompare(b))
  );
const canExpandSecrets = (options: FleetMutationOptions) =>
  options.allowSecretScopeExpansion === true;

export async function lockRunbookPool(
  tx: Prisma.TransactionClient,
  id: string,
  expectedRevision?: number
) {
  await tx.$queryRaw`SELECT id FROM "RunbookAgentPool" WHERE id = ${id} FOR UPDATE`;
  const pool = await tx.runbookAgentPool.findUnique({ where: { id } });
  if (!pool) throw notFound();
  if (expectedRevision !== undefined && pool.revision !== expectedRevision)
    throw preconditionFailed();
  return pool;
}
async function guardPoolSecretExpansion(
  tx: Prisma.TransactionClient,
  poolId: string,
  options: FleetMutationOptions
) {
  if (
    !canExpandSecrets(options) &&
    (await tx.runbookSecretGrant.findFirst({
      where: { agentPoolId: poolId },
      select: { id: true },
    }))
  ) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage:
        'Changing access to a secret-granted pool additionally requires the explicit secret-grant scope.',
    });
  }
}
export async function getRunbookPoolDependencies(
  tx: Pick<
    Prisma.TransactionClient,
    'serviceAutomationRule' | 'runbookExecution' | 'runbookStepAttempt' | 'runbookSecretGrant'
  >,
  id: string
) {
  const [serviceRules, executions, attempts, secretGrants] = await Promise.all([
    tx.serviceAutomationRule.count({ where: { defaultAgentPoolId: id } }),
    tx.runbookExecution.count({ where: { resolvedTargetAgentPoolId: id } }),
    tx.runbookStepAttempt.count({ where: { targetAgentPoolId: id } }),
    tx.runbookSecretGrant.count({ where: { agentPoolId: id } }),
  ]);
  return { serviceRules, executions, attempts, secretGrants };
}
export async function createRunbookAgentPool(
  raw: unknown,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  const input = createRunbookAgentPoolSchema.parse(raw);
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const pool = await tx.runbookAgentPool.create({
      data: { ...input, createdById: actorId(actor) },
    });
    await synchronizeLabelMemberships(tx, pool.id);
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.agent_pool.created',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: pool.id,
        actorId: actorId(actor),
        details: { name: pool.name, mode: pool.mode },
      },
      tx
    );
    return tx.runbookAgentPool.findUniqueOrThrow({ where: { id: pool.id } });
  });
}
export async function updateRunbookAgentPool(
  id: string,
  raw: unknown,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  const input = updateRunbookAgentPoolSchema.parse(raw);
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const pool = await lockRunbookPool(tx, id, options.expectedRevision);
    if (pool.lifecycle !== 'ACTIVE') throw conflict('Retired pools cannot be reconfigured.');
    const selectorChanged =
      input.matchLabels !== undefined &&
      stableLabels(input.matchLabels) !== stableLabels(pool.matchLabels);
    if (selectorChanged && Object.keys(input.matchLabels!).length > 0) {
      const added = await tx.$queryRaw<Array<{ expansion: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM "RunbookAgent" a
        WHERE a.status <> 'REVOKED' AND a.labels @> ${JSON.stringify(input.matchLabels)}::jsonb
          AND NOT EXISTS (SELECT 1 FROM "RunbookAgentPoolMember" m WHERE m."poolId" = ${id} AND m."agentId" = a.id)
      ) AS expansion`;
      if (added[0]?.expansion) await guardPoolSecretExpansion(tx, id, options);
    }
    if (input.mode !== undefined && input.mode !== pool.mode) {
      const dependencies = await getRunbookPoolDependencies(tx, id);
      if (Object.values(dependencies).some(Boolean))
        throw conflict(
          'Pool execution mode cannot change while rules, executions, attempts or secret grants reference it.'
        );
    }
    const changed = Object.entries(input).some(([key, value]) =>
      key === 'matchLabels' ? selectorChanged : Reflect.get(pool, key) !== value
    );
    if (!changed) return pool;
    await tx.runbookAgentPool.update({ where: { id }, data: input });
    await synchronizeLabelMemberships(tx, pool.id);
    await logRunbookCommandAudit(
      actor,
      {
        action:
          Object.keys(input).length === 1 && input.matchLabels !== undefined
            ? 'runbook.scheduling_labels.updated'
            : 'runbook.agent_pool.updated',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: id,
        actorId: actorId(actor),
        details: { changedFields: Object.keys(input) },
      },
      tx
    );
    return tx.runbookAgentPool.findUniqueOrThrow({ where: { id } });
  });
}
export async function deleteRunbookAgentPool(
  id: string,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const pool = await lockRunbookPool(tx, id, options.expectedRevision);
    const dependencies = await getRunbookPoolDependencies(tx, id);
    if (Object.values(dependencies).some(Boolean))
      throw conflict(
        'Remove pool rules and grants first. Historical execution or attempt references prevent deletion.'
      );
    await tx.runbookAgentPool.delete({ where: { id } });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.agent_pool.deleted',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: id,
        actorId: actorId(actor),
        details: { name: pool.name },
      },
      tx
    );
    return { id, deleted: true };
  });
}
export async function setRunbookPoolMember(
  poolId: string,
  agentId: string,
  present: boolean,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const pool = await lockRunbookPool(tx, poolId, options.expectedRevision);
    if (present && pool.lifecycle !== 'ACTIVE')
      throw conflict('Retired pools cannot receive members.');
    const agent = await tx.runbookAgent.findUnique({
      where: { id: agentId },
      select: { id: true, status: true, labels: true },
    });
    if (!agent) throw notFound();
    const existing = await tx.runbookAgentPoolMember.findUnique({
      where: { poolId_agentId: { poolId, agentId } },
    });
    if (present) {
      if (agent.status === 'REVOKED') throw conflict('A revoked Agent cannot join a pool.');
      if (existing?.source === 'EXPLICIT') return { pool, membership: existing };
      await guardPoolSecretExpansion(tx, poolId, options);
      const membership = await tx.runbookAgentPoolMember.upsert({
        where: { poolId_agentId: { poolId, agentId } },
        create: { poolId, agentId },
        update: { source: 'EXPLICIT' },
      });
      await logRunbookCommandAudit(
        actor,
        {
          action: 'runbook.agent_pool.member_added',
          entityType: 'RUNBOOK_AGENT_POOL',
          entityId: poolId,
          actorId: actorId(actor),
          details: { agentId, membershipId: membership.id },
        },
        tx
      );
    } else {
      if (!existing) return { pool, membership: null };
      if (existing.source === 'DYNAMIC')
        throw conflict('Change the pool selector or Agent labels to remove dynamic membership.');
      const selector = schedulingLabelsSchema.parse(pool.matchLabels);
      const labels = schedulingLabelsSchema.parse(agent.labels);
      if (
        pool.lifecycle === 'ACTIVE' &&
        agent.status !== 'REVOKED' &&
        Object.keys(selector).length > 0 &&
        Object.entries(selector).every(([key, value]) => Reflect.get(labels, key) === value)
      ) {
        throw conflict(
          'Agent still matches the pool selector. Change the selector or Agent labels before removing membership.'
        );
      }
      await tx.runbookAgentPoolMember.delete({ where: { id: existing.id } });
      await synchronizeLabelMemberships(tx, pool.id);
      await logRunbookCommandAudit(
        actor,
        {
          action: 'runbook.agent_pool.member_removed',
          entityType: 'RUNBOOK_AGENT_POOL',
          entityId: poolId,
          actorId: actorId(actor),
          details: { agentId, membershipId: existing.id },
        },
        tx
      );
    }
    return {
      pool: await tx.runbookAgentPool.findUniqueOrThrow({ where: { id: poolId } }),
      membership: await tx.runbookAgentPoolMember.findUnique({
        where: { poolId_agentId: { poolId, agentId } },
      }),
    };
  });
}
export async function updateRunbookAgentMetadata(
  id: string,
  raw: unknown,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  const input = updateRunbookAgentMetadataSchema.parse(raw);
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    await tx.$queryRaw`SELECT id FROM "RunbookAgent" WHERE id = ${id} FOR UPDATE`;
    const agent = await tx.runbookAgent.findUnique({ where: { id } });
    if (!agent) throw notFound();
    if (
      options.expectedRevision !== undefined &&
      agent.configurationRevision !== options.expectedRevision
    )
      throw preconditionFailed();
    if (agent.status === 'REVOKED') throw conflict('A revoked Agent cannot be reconfigured.');
    const labelsChanged =
      input.labels !== undefined && stableLabels(input.labels) !== stableLabels(agent.labels);
    if (labelsChanged && !canExpandSecrets(options)) {
      const expansion = await tx.$queryRaw<Array<{ expansion: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM "RunbookAgentPool" p
        WHERE p.lifecycle = 'ACTIVE' AND p."matchLabels" <> '{}'::jsonb AND ${JSON.stringify(input.labels)}::jsonb @> p."matchLabels"
          AND EXISTS (SELECT 1 FROM "RunbookSecretGrant" g WHERE g."agentPoolId" = p.id)
          AND NOT EXISTS (SELECT 1 FROM "RunbookAgentPoolMember" m WHERE m."poolId" = p.id AND m."agentId" = ${id})
      ) AS expansion`;
      if (expansion[0]?.expansion)
        throw new AppError({
          code: 'AUTHORIZATION_DENIED',
          userMessage:
            'Labels would expand secret-granted pool access; the explicit secret-grant scope is required.',
        });
    }
    if (!labelsChanged && (input.name === undefined || input.name === agent.name)) return agent;
    await tx.runbookAgent.update({ where: { id }, data: input });
    await synchronizeAgentLabelMemberships(tx, id);
    await logRunbookCommandAudit(
      actor,
      {
        action:
          input.name === undefined ? 'runbook.scheduling_labels.updated' : 'runbook.agent.updated',
        entityType: 'RUNBOOK_AGENT',
        entityId: id,
        actorId: actorId(actor),
        details: { changedFields: Object.keys(input) },
      },
      tx
    );
    return tx.runbookAgent.findUniqueOrThrow({ where: { id } });
  });
}

export async function removeRunbookPoolMemberById(memberId: string, actor: RunbookCommandActor) {
  return runRunbookCommand(undefined, async tx => {
    await lockFleetConfiguration(tx);
    const member = await tx.runbookAgentPoolMember.findUnique({ where: { id: memberId } });
    if (!member) throw notFound();
    return setRunbookPoolMember(member.poolId, member.agentId, false, actor, { client: tx });
  });
}

export async function retireRunbookAgentPool(
  id: string,
  actor: RunbookCommandActor,
  options: FleetMutationOptions = {}
) {
  return runRunbookCommand(options.client, async tx => {
    await lockFleetConfiguration(tx);
    const pool = await lockRunbookPool(tx, id, options.expectedRevision);
    if (pool.lifecycle === 'RETIRED') return pool;
    const updated = await tx.runbookAgentPool.update({
      where: { id },
      data: { lifecycle: 'RETIRED', retiredAt: new Date() },
    });
    const disabled = await tx.serviceAutomationRule.updateMany({
      where: { defaultAgentPoolId: id, enabled: true },
      data: { enabled: false },
    });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.agent_pool.retired',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: id,
        actorId: actorId(actor),
        details: { disabledBindings: disabled.count },
      },
      tx
    );
    return updated;
  });
}
