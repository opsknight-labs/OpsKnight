import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { PROACTIVE_LIMITS } from './contract';

type Client = Prisma.TransactionClient | typeof prisma;

export interface SquireMemorySettingsView {
  knowledgeEnabled: boolean;
  revision: number;
}

export interface SquireServicePolicyView {
  serviceId: string;
  briefingEnabled: boolean;
  nudgeAfterMinutes: number | null;
  postmortemDraftEnabled: boolean;
  revision: number;
}

const OFF: SquireMemorySettingsView = { knowledgeEnabled: false, revision: 0 };

/** The knowledge index is off until an administrator turns it on; a missing row means off. */
export async function getSquireMemorySettings(
  client: Client = prisma
): Promise<SquireMemorySettingsView> {
  const row = await client.squireMemorySettings.findUnique({
    where: { id: 'default' },
    select: { knowledgeEnabled: true, revision: true },
  });
  return row ?? OFF;
}

/** For callers that must never fail because of this feature: any read error means off. */
export async function squireKnowledgeEnabled(): Promise<boolean> {
  try {
    return (await getSquireMemorySettings()).knowledgeEnabled;
  } catch {
    return false;
  }
}

const memoryInput = z
  .object({ knowledgeEnabled: z.boolean(), expectedRevision: z.number().int().nonnegative() })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Check the values and try again.',
    });
  return parsed.data;
}

/**
 * Compare-and-set on the revision, serialised by an advisory lock and audited in the same transaction, like
 * every other intelligence setting: a stale page can never silently overwrite a newer decision.
 */
export async function updateSquireMemorySettings(
  input: unknown,
  actorId: string
): Promise<SquireMemorySettingsView> {
  const { expectedRevision, knowledgeEnabled } = parse(memoryInput, input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('squire-memory-settings', 0))::text AS locked`;
    const previous = await getSquireMemorySettings(tx);
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const next = await tx.squireMemorySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', knowledgeEnabled, revision: 1 },
      update: { knowledgeEnabled, revision: { increment: 1 } },
      select: { knowledgeEnabled: true, revision: true },
    });
    await logAudit(
      {
        action: 'intelligence.squire.memory.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'squire-memory',
        actorId,
        source: 'UI',
        oldValue: { ...previous },
        newValue: { ...next },
      },
      tx
    );
    return next;
  });
}

const policyDefaults = (serviceId: string): SquireServicePolicyView => ({
  serviceId,
  briefingEnabled: false,
  nudgeAfterMinutes: null,
  postmortemDraftEnabled: false,
  revision: 0,
});

const POLICY_SELECT = {
  serviceId: true,
  briefingEnabled: true,
  nudgeAfterMinutes: true,
  postmortemDraftEnabled: true,
  revision: true,
} as const;

/** A service without a row has every proactive switch off. */
export async function getSquireServicePolicy(
  serviceId: string,
  client: Client = prisma
): Promise<SquireServicePolicyView> {
  return (
    (await client.squireServicePolicy.findUnique({
      where: { serviceId },
      select: POLICY_SELECT,
    })) ?? policyDefaults(serviceId)
  );
}

const policyInput = z
  .object({
    briefingEnabled: z.boolean(),
    nudgeAfterMinutes: z
      .number()
      .int()
      .min(PROACTIVE_LIMITS.minNudgeMinutes)
      .max(PROACTIVE_LIMITS.maxNudgeMinutes)
      .nullable(),
    postmortemDraftEnabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export async function updateSquireServicePolicy(
  serviceId: string,
  input: unknown,
  actorId: string
): Promise<SquireServicePolicyView> {
  const { expectedRevision, ...values } = parse(policyInput, input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`squire-service-policy:${serviceId}`}, 0))::text AS locked`;
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const previous = await getSquireServicePolicy(serviceId, tx);
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const next = await tx.squireServicePolicy.upsert({
      where: { serviceId },
      create: { serviceId, ...values, revision: 1 },
      update: { ...values, revision: { increment: 1 } },
      select: POLICY_SELECT,
    });
    await logAudit(
      {
        action: 'intelligence.squire.proactive_policy.updated',
        entityType: 'SERVICE',
        entityId: serviceId,
        actorId,
        source: 'UI',
        oldValue: { ...previous },
        newValue: { ...next },
      },
      tx
    );
    return next;
  });
}

/** Services with any proactive switch on, bounded; the lane's scan reads only these. */
export async function listProactivePolicies(
  client: Client = prisma
): Promise<SquireServicePolicyView[]> {
  return client.squireServicePolicy.findMany({
    where: {
      OR: [
        { briefingEnabled: true },
        { nudgeAfterMinutes: { not: null } },
        { postmortemDraftEnabled: true },
      ],
    },
    orderBy: { serviceId: 'asc' },
    take: PROACTIVE_LIMITS.maxPolicies,
    select: POLICY_SELECT,
  });
}
