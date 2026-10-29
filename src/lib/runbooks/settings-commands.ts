import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import {
  runRunbookCommand,
  logRunbookCommandAudit,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';

const budget = z.number().int().min(0).max(100);
export const runbookSettingsPatchSchema = z
  .object({
    runbookArtifactRetentionDays: z.number().int().min(1).max(3650).optional(),
    confirmArtifactCleanup: z.literal(true).optional(),
    runbookAutoExecutionsPerIncident: budget.optional(),
    runbookAutoWritesPerIncident: budget.optional(),
    runbookAutoNonIdempotentPerIncident: budget.optional(),
  })
  .strict()
  .refine(
    input => Object.keys(input).some(key => key !== 'confirmArtifactCleanup'),
    'At least one setting is required.'
  )
  .refine(
    input =>
      input.runbookArtifactRetentionDays === undefined || input.confirmArtifactCleanup === true,
    'Artifact retention changes require explicit cleanup confirmation.'
  );
export const runbookSettingsSelect = {
  runbookArtifactRetentionDays: true,
  runbookAutoExecutionsPerIncident: true,
  runbookAutoWritesPerIncident: true,
  runbookAutoNonIdempotentPerIncident: true,
  runbookSettingsRevision: true,
} satisfies Prisma.SystemSettingsSelect;
export async function readRunbookSettings(tx: Pick<Prisma.TransactionClient, 'systemSettings'>) {
  const row = await tx.systemSettings.findUnique({
    where: { id: 'default' },
    select: runbookSettingsSelect,
  });
  return (
    row ?? {
      runbookArtifactRetentionDays: null,
      runbookAutoExecutionsPerIncident: 3,
      runbookAutoWritesPerIncident: 3,
      runbookAutoNonIdempotentPerIncident: 0,
      runbookSettingsRevision: 0,
    }
  );
}
export async function updateRunbookSettings(
  raw: unknown,
  actor: RunbookCommandActor,
  options: { client?: RunbookCommandClient; expectedRevision: number }
) {
  const { confirmArtifactCleanup: _confirmation, ...input } = runbookSettingsPatchSchema.parse(raw);
  return runRunbookCommand(options.client, async tx => {
    // Also fence creation when no workspace settings row exists yet.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('opsknight:runbook-settings'))::text`;
    await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR UPDATE`;
    const previous = await readRunbookSettings(tx);
    if (previous.runbookSettingsRevision !== options.expectedRevision) throw preconditionFailed();
    if (!Object.entries(input).some(([key, value]) => Reflect.get(previous, key) !== value))
      return previous;
    const row = await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...input },
      update: input,
      select: runbookSettingsSelect,
    });
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'default',
        actorId: typeof actor === 'string' ? actor : actor.id,
        details: {
          changedFields: Object.keys(input),
          destructiveCleanupConfirmed: input.runbookArtifactRetentionDays !== undefined,
        },
      },
      tx
    );
    return row;
  });
}
