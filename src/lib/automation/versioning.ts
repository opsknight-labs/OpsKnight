import 'server-only';
import { getAutomationSettings } from './settings';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { compileAutomation } from './compiler';
import { logger } from '@/lib/logger';
import { checksum, loadCompiledVersion } from './cache';
import { snapshotSchema, emptySnapshot, type CompiledSnapshot } from './contract';
import { MAX_ESCALATION_STEPS } from '@/lib/escalation/automation-snapshot';
export class AutomationConflict extends Error {
  constructor() {
    super('Another version was saved. Reload or review your changes before saving.');
  }
}
export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function lock(tx: Prisma.TransactionClient, serviceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation:${serviceId}`}, 0))`;
}
async function audit(
  tx: Prisma.TransactionClient,
  serviceId: string,
  actorId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown
) {
  await emitAuditEvent(
    {
      action,
      source: 'UI',
      target: { type: 'SERVICE', id: serviceId },
      actor: { type: 'USER', id: actorId },
      oldValue: asJson(oldValue),
      newValue: asJson(newValue),
    },
    tx
  );
}
export async function saveDraft(input: {
  serviceId: string;
  actorId: string;
  snapshot: unknown;
  expectedRevision: number;
}) {
  const snapshot = snapshotSchema.parse(input.snapshot);
  return runSerializableTransaction(async tx => {
    await lock(tx, input.serviceId);
    const previous = await tx.automationDraft.findUnique({ where: { serviceId: input.serviceId } });
    if ((previous?.revision ?? 0) !== input.expectedRevision) throw new AutomationConflict();
    const draft = await tx.automationDraft.upsert({
      where: { serviceId: input.serviceId },
      create: { serviceId: input.serviceId, snapshot: asJson(snapshot), updatedBy: input.actorId },
      update: { snapshot: asJson(snapshot), revision: { increment: 1 }, updatedBy: input.actorId },
    });
    await tx.serviceAutomationConfig.upsert({
      where: { serviceId: input.serviceId },
      create: { serviceId: input.serviceId, draftId: draft.id, updatedBy: input.actorId },
      update: { draftId: draft.id, updatedBy: input.actorId },
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      'automation.draft.updated',
      { revision: previous?.revision ?? 0 },
      { revision: draft.revision }
    );
    if (
      JSON.stringify((previous?.snapshot as { fields?: unknown } | undefined)?.fields ?? []) !==
      JSON.stringify(snapshot.fields)
    )
      await audit(
        tx,
        input.serviceId,
        input.actorId,
        'automation.context.mapping.updated',
        { revision: previous?.revision ?? 0 },
        { revision: draft.revision, fieldCount: snapshot.fields.length }
      );
    return draft;
  });
}
export async function validateReferences(
  tx: Prisma.TransactionClient,
  serviceId: string,
  compiled: CompiledSnapshot
) {
  const policyIds = [
    ...new Set(
      compiled.rules.flatMap(r =>
        r.actions.flatMap(a => (a.type === 'USE_ESCALATION_POLICY' ? [a.policyId] : []))
      )
    ),
  ];
  const policies = await tx.escalationPolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, name: true, _count: { select: { steps: true } } },
  });
  if (policies.length !== policyIds.length)
    throw new Error('A referenced escalation policy is missing');
  for (const policy of policies) {
    if (policy._count.steps > MAX_ESCALATION_STEPS) {
      throw new Error(
        `Referenced escalation policy "${policy.name}" exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`
      );
    }
  }
  const notifications = compiled.rules.flatMap(r =>
    r.actions.filter(a => a.type === 'NOTIFY_CHANNEL')
  );
  for (const action of notifications) {
    const destination =
      action.provider === 'SLACK'
        ? await tx.slackDestination.findFirst({
            where: { id: action.destinationId, serviceId, enabled: true },
          })
        : await tx.microsoftTeamsDestination.findFirst({
            where: { id: action.destinationId, serviceId, enabled: true },
          });
    if (!destination)
      throw new Error(
        'Notification destination is missing, disabled, or belongs to another service'
      );
  }
  return policies;
}
export async function publishVersion(input: {
  serviceId: string;
  actorId: string;
  expectedRevision: number;
  expectedActiveVersionId: string | null;
  sourceVersionId?: string;
}) {
  return runSerializableTransaction(async tx => {
    await lock(tx, input.serviceId);
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: input.serviceId },
    });
    if ((config?.activeVersionId ?? null) !== input.expectedActiveVersionId)
      throw new AutomationConflict();
    const draft = await tx.automationDraft.findUnique({ where: { serviceId: input.serviceId } });
    if ((draft?.revision ?? 0) !== input.expectedRevision) throw new AutomationConflict();
    const source = input.sourceVersionId
      ? await tx.automationVersion.findFirst({
          where: { id: input.sourceVersionId, serviceId: input.serviceId },
        })
      : null;
    if (input.sourceVersionId && !source)
      throw new Error('Source version does not belong to this service');
    const snapshot = source?.snapshot ?? draft?.snapshot ?? emptySnapshot;
    const { compiled, issues } = compileAutomation(snapshot);
    if (issues.some(i => i.level === 'ERROR'))
      throw new Error(
        issues
          .filter(i => i.level === 'ERROR')
          .map(i => i.message)
          .join('; ')
      );
    const policies = await validateReferences(tx, input.serviceId, compiled);
    for (const policy of policies)
      if (!policy._count.steps)
        issues.push({
          level: 'WARNING',
          code: 'EMPTY_POLICY',
          message: `Policy ${policy.name} has no steps`,
        });
    const previous = await tx.automationVersion.findFirst({
      where: { serviceId: input.serviceId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const version = await tx.automationVersion.create({
      data: {
        serviceId: input.serviceId,
        versionNumber: (previous?.versionNumber ?? 0) + 1,
        snapshot: asJson(snapshot),
        compiledSnapshot: asJson(compiled),
        checksum: checksum(compiled),
        sourceVersionId: source?.id,
        publishedBy: input.actorId,
        lintReport: asJson(issues),
        policyRefs: {
          create: policies.map(p => ({ escalationPolicyId: p.id, policyNameSnapshot: p.name })),
        },
      },
    });
    await tx.serviceAutomationConfig.upsert({
      where: { serviceId: input.serviceId },
      create: { serviceId: input.serviceId, activeVersionId: version.id, updatedBy: input.actorId },
      update: { activeVersionId: version.id, updatedBy: input.actorId },
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      source ? 'automation.rollback.published' : 'automation.version.published',
      { versionId: config?.activeVersionId ?? null },
      { versionId: version.id, lint: issues }
    );
    logger.info('automation.version.published', {
      serviceId: input.serviceId,
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
    return version;
  });
}
export async function changeMode(input: {
  serviceId: string;
  actorId: string;
  mode: 'DISABLED' | 'SHADOW' | 'LIVE';
  expectedActiveVersionId: string | null;
  acknowledgeNoShadow?: boolean;
  acknowledgeShadowErrors?: boolean;
}) {
  return runSerializableTransaction(async tx => {
    await lock(tx, input.serviceId);
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: input.serviceId },
      include: { activeVersion: true },
    });
    if ((config?.activeVersionId ?? null) !== input.expectedActiveVersionId)
      throw new AutomationConflict();
    if (input.mode !== 'DISABLED') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
      // A row lock fences a Serializable snapshot taken before an admin toggle.
      // PostgreSQL aborts/retries stale snapshots instead of staging LIVE behind OFF.
      await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR UPDATE`;
      if (!(await getAutomationSettings(tx)).automationEnabled)
        throw new Error(
          'Enable global automation before selecting SHADOW or LIVE. Drafts and publication remain available.'
        );
      if (!config?.activeVersion) throw new Error('Publish a version before enabling automation');
      loadCompiledVersion(config.activeVersion);
      const { compiled, issues } = compileAutomation(config.activeVersion.snapshot);
      if (issues.some(i => i.level === 'ERROR'))
        throw new Error('Active version has blocking lint errors');
      await validateReferences(tx, input.serviceId, compiled);
      if (input.mode === 'LIVE') {
        const evidence = await tx.automationShadowAggregate.aggregate({
          where: {
            serviceId: input.serviceId,
            versionId: config.activeVersion.id,
            bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
          },
          _sum: { evaluated: true, errors: true, fallbacks: true },
        });
        if (!evidence._sum.evaluated && !input.acknowledgeNoShadow)
          throw new Error(
            'Acknowledge activation without Shadow traffic for this published version.'
          );
        if ((evidence._sum.errors || evidence._sum.fallbacks) && !input.acknowledgeShadowErrors)
          throw new Error(
            'Explicitly acknowledge Shadow errors and fallbacks before activating LIVE.'
          );
      }
    }
    const updated = await tx.serviceAutomationConfig.upsert({
      where: { serviceId: input.serviceId },
      create: { serviceId: input.serviceId, mode: input.mode, updatedBy: input.actorId },
      update: { mode: input.mode, updatedBy: input.actorId },
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      'automation.mode.changed',
      { mode: config?.mode ?? 'DISABLED' },
      { mode: input.mode, versionId: updated.activeVersionId }
    );
    if (input.mode !== 'DISABLED')
      await audit(
        tx,
        input.serviceId,
        input.actorId,
        input.mode === 'LIVE' ? 'automation.live.enabled' : 'automation.shadow.enabled',
        { mode: config?.mode ?? 'DISABLED' },
        {
          mode: input.mode,
          versionId: updated.activeVersionId,
          ...(input.mode === 'LIVE'
            ? {
                acknowledgeNoShadow: input.acknowledgeNoShadow === true,
                acknowledgeShadowErrors: input.acknowledgeShadowErrors === true,
              }
            : {}),
        }
      );
    logger.info('automation.mode.changed', {
      serviceId: input.serviceId,
      mode: input.mode,
      versionId: updated.activeVersionId,
    });
    return updated;
  });
}
