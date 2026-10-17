import { AppError } from '@/lib/errors';
import { assertPolicyActive } from '@/lib/escalation/policy-lifecycle';
import 'server-only';
import { getAutomationSettings } from './settings';
import { lockAutomationService as lock } from './locking';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { compileAutomation } from './compiler';
import { logger } from '@/lib/logger';
import { checksum, loadCompiledVersion } from './cache';
import { snapshotSchema, emptySnapshot, type CompiledSnapshot } from './contract';
import {
  MAX_ESCALATION_STEPS,
  assertResponderPolicySnapshotSafe,
} from '@/lib/escalation/automation-snapshot';
class AutomationValidationError extends AppError {
  constructor(message: string) {
    super({ code: 'VALIDATION_FAILED', userMessage: message });
  }
}

export class AutomationConflict extends Error {
  constructor() {
    super('Another version was saved. Reload or review your changes before saving.');
  }
}
export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function audit(
  tx: Prisma.TransactionClient,
  serviceId: string,
  actorId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  apiClientId?: string
) {
  await emitAuditEvent(
    {
      action,
      source: apiClientId ? 'API' : 'UI',
      ...(apiClientId ? { metadata: { apiClientId } } : {}),
      target: { type: 'SERVICE', id: serviceId },
      actor: { type: 'USER', id: actorId },
      oldValue: asJson(oldValue),
      newValue: asJson(newValue),
    },
    tx
  );
}
export async function saveDraft(
  input: {
    serviceId: string;
    actorId: string;
    snapshot: unknown;
    expectedRevision: number;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const snapshot = snapshotSchema.parse(input.snapshot);
  const run = async (tx: Prisma.TransactionClient) => {
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
      { revision: draft.revision },
      apiClientId
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
        { revision: draft.revision, fieldCount: snapshot.fields.length },
        apiClientId
      );
    return draft;
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
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
  for (const policyId of [...policyIds].sort()) await assertPolicyActive(tx, policyId);
  const policies = await tx.escalationPolicy.findMany({
    where: { id: { in: policyIds } },
    select: { id: true, name: true, _count: { select: { steps: true } } },
  });
  if (policies.length !== policyIds.length)
    throw new AutomationValidationError('A referenced escalation policy is missing');
  for (const policy of policies) {
    if (policy._count.steps > MAX_ESCALATION_STEPS) {
      throw new AutomationValidationError(
        `Referenced escalation policy "${policy.name}" exceeds maximum step limit of ${MAX_ESCALATION_STEPS}`
      );
    }
    await assertResponderPolicySnapshotSafe(tx, policy.id);
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
      throw new AutomationValidationError(
        'Notification destination is missing, disabled, or belongs to another service'
      );
  }
  return policies;
}
export async function publishVersion(
  input: {
    serviceId: string;
    actorId: string;
    expectedRevision: number;
    expectedActiveVersionId: string | null;
    expectedCandidateVersionId?: string | null;
    sourceVersionId?: string;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const run = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.serviceId);
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: input.serviceId },
    });
    if ((config?.activeVersionId ?? null) !== input.expectedActiveVersionId)
      throw new AutomationConflict();
    if (config?.mode === 'LIVE') {
      const currentCandidateId = config?.candidateVersionId ?? null;
      if (
        input.expectedCandidateVersionId !== undefined &&
        currentCandidateId !== input.expectedCandidateVersionId
      ) {
        throw new AutomationConflict();
      }
      if (currentCandidateId !== null && input.expectedCandidateVersionId === undefined) {
        throw new AutomationConflict();
      }
    }
    const draft = await tx.automationDraft.findUnique({ where: { serviceId: input.serviceId } });
    if ((draft?.revision ?? 0) !== input.expectedRevision) throw new AutomationConflict();
    const source = input.sourceVersionId
      ? await tx.automationVersion.findFirst({
          where: { id: input.sourceVersionId, serviceId: input.serviceId },
        })
      : null;
    if (input.sourceVersionId && !source)
      throw new AutomationValidationError('Source version does not belong to this service');
    const snapshot = snapshotSchema.parse(source?.snapshot ?? draft?.snapshot ?? emptySnapshot);
    const { compiled, issues } = compileAutomation(snapshot);
    if (issues.some(i => i.level === 'ERROR'))
      throw new AutomationValidationError(
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
          create: policies.map(p => ({
            escalationPolicyId: p.id,
            policyNameSnapshot: p.name,
            ruleReferences: asJson(
              snapshot.rules
                .filter(rule =>
                  rule.actions.some(
                    action => action.type === 'USE_ESCALATION_POLICY' && action.policyId === p.id
                  )
                )
                .map(rule => ({ id: rule.id, name: rule.name, enabled: rule.enabled }))
            ),
          })),
        },
      },
    });
    // When the service is currently LIVE, publish the new version as a candidate so the
    // existing LIVE version keeps routing production incidents. When SHADOW or DISABLED,
    // the new version immediately becomes the sole active version (no routing risk).
    const updatePayload =
      config?.mode === 'LIVE'
        ? { candidateVersionId: version.id, updatedBy: input.actorId }
        : { activeVersionId: version.id, candidateVersionId: null, updatedBy: input.actorId };
    await tx.serviceAutomationConfig.upsert({
      where: { serviceId: input.serviceId },
      create: { serviceId: input.serviceId, activeVersionId: version.id, updatedBy: input.actorId },
      update: updatePayload,
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      source ? 'automation.rollback.published' : 'automation.version.published',
      { versionId: config?.activeVersionId ?? null, candidateVersionId: config?.candidateVersionId ?? null },
      {
        versionId: version.id,
        lint: issues,
        staged: config?.mode === 'LIVE' ? 'candidate' : 'active',
      },
      apiClientId
    );
    logger.info('automation.version.publication.staged', {
      serviceId: input.serviceId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      staged: config?.mode === 'LIVE' ? 'candidate' : 'active',
    });
    return version;
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
}

/**
 * Atomically promote the current candidateVersionId to become activeVersionId.
 * Validates shadow evidence and escalation policy safety before the swap, then
 * clears candidateVersionId in the same transaction. This is the zero-interruption
 * LIVE upgrade path: the previous LIVE version keeps routing until this point.
 */
export async function activateCandidate(
  input: {
    serviceId: string;
    actorId: string;
    expectedCandidateVersionId: string;
    expectedActiveVersionId?: string | null;
    acknowledgeNoShadow?: boolean;
    acknowledgeShadowErrors?: boolean;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const run = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.serviceId);
    const settings = await getAutomationSettings(tx);
    if (!settings.automationEnabled)
      throw new AutomationValidationError(
        'System automation is globally disabled. Enable global automation before activating a candidate version.'
      );
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: input.serviceId },
      include: { candidateVersion: true },
    });
    if (config?.mode !== 'LIVE')
      throw new AutomationValidationError(
        'Candidate version promotion requires the service to be in LIVE mode.'
      );
    if (!config?.candidateVersionId)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'No published candidate version is waiting for activation.',
      });
    if (config.candidateVersionId !== input.expectedCandidateVersionId)
      throw new AutomationConflict();
    if (
      input.expectedActiveVersionId !== undefined &&
      (config.activeVersionId ?? null) !== input.expectedActiveVersionId
    )
      throw new AutomationConflict();
    if (!config.candidateVersion)
      throw new AppError({ code: 'INTERNAL_ERROR', details: { reason: 'candidate version missing' } });

    // Re-validate the candidate before cutover.
    loadCompiledVersion(config.candidateVersion);
    const { compiled, issues } = compileAutomation(config.candidateVersion.snapshot);
    if (issues.some(i => i.level === 'ERROR'))
      throw new AutomationValidationError('Candidate version has blocking lint errors');
    await validateReferences(tx, input.serviceId, compiled);

    // Escalation policy safety — same gate as changeMode → LIVE.
    const service = await tx.service.findUnique({
      where: { id: input.serviceId },
      select: { escalationPolicyId: true },
    });
    if (service?.escalationPolicyId) {
      try {
        await assertResponderPolicySnapshotSafe(tx, service.escalationPolicyId);
      } catch (error) {
        throw new AutomationValidationError(
          `Service default escalation policy is unsafe for LIVE automation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Shadow evidence gate — same acknowledgement flags as changeMode → LIVE.
    const evidence = await tx.automationShadowAggregate.aggregate({
      where: {
        serviceId: input.serviceId,
        versionId: config.candidateVersion.id,
        bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
      },
      _sum: { evaluated: true, errors: true, fallbacks: true },
    });
    if (!evidence._sum.evaluated && !input.acknowledgeNoShadow)
      throw new AutomationValidationError(
        'Acknowledge activation without Shadow traffic for this candidate version.'
      );
    if ((evidence._sum.errors || evidence._sum.fallbacks) && !input.acknowledgeShadowErrors)
      throw new AutomationValidationError(
        'Explicitly acknowledge Shadow errors and fallbacks before activating the candidate.'
      );

    // Atomic cutover: swap candidate → active, clear candidate.
    const updated = await tx.serviceAutomationConfig.update({
      where: { serviceId: input.serviceId },
      data: {
        activeVersionId: config.candidateVersionId,
        candidateVersionId: null,
        updatedBy: input.actorId,
      },
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      'automation.candidate.activated',
      { activeVersionId: config.activeVersionId, candidateVersionId: config.candidateVersionId },
      {
        activeVersionId: updated.activeVersionId,
        candidateVersionId: null,
        acknowledgeNoShadow: input.acknowledgeNoShadow === true,
        acknowledgeShadowErrors: input.acknowledgeShadowErrors === true,
      },
      apiClientId
    );
    logger.info('automation.candidate.activated', {
      serviceId: input.serviceId,
      previousActiveVersionId: config.activeVersionId,
      newActiveVersionId: updated.activeVersionId,
    });
    return updated;
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
}

/**
 * Discard a pending candidate version without promoting it.
 * Clears candidateVersionId and logs an audit record.
 */
export async function discardCandidate(
  input: {
    serviceId: string;
    actorId: string;
    expectedCandidateVersionId: string;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const run = async (tx: Prisma.TransactionClient) => {
    await lock(tx, input.serviceId);
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId: input.serviceId },
    });
    if (!config?.candidateVersionId) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'No published candidate version exists to discard.',
      });
    }
    if (config.candidateVersionId !== input.expectedCandidateVersionId) {
      throw new AutomationConflict();
    }
    const updated = await tx.serviceAutomationConfig.update({
      where: { serviceId: input.serviceId },
      data: {
        candidateVersionId: null,
        updatedBy: input.actorId,
      },
    });
    await audit(
      tx,
      input.serviceId,
      input.actorId,
      'automation.candidate.discarded',
      { candidateVersionId: config.candidateVersionId },
      { candidateVersionId: null },
      apiClientId
    );
    logger.info('automation.candidate.discarded', {
      serviceId: input.serviceId,
      discardedCandidateVersionId: config.candidateVersionId,
    });
    return updated;
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
}
export async function changeMode(
  input: {
    serviceId: string;
    actorId: string;
    mode: 'DISABLED' | 'SHADOW' | 'LIVE';
    expectedActiveVersionId: string | null;
    acknowledgeNoShadow?: boolean;
    acknowledgeShadowErrors?: boolean;
  },
  externalTx?: Prisma.TransactionClient,
  apiClientId?: string
) {
  const run = async (tx: Prisma.TransactionClient) => {
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
        throw new AutomationValidationError(
          'Enable global automation before selecting SHADOW or LIVE. Drafts and publication remain available.'
        );
      if (!config?.activeVersion)
        throw new AutomationValidationError('Publish a version before enabling automation');
      loadCompiledVersion(config.activeVersion);
      const { compiled, issues } = compileAutomation(config.activeVersion.snapshot);
      if (issues.some(i => i.level === 'ERROR'))
        throw new AutomationValidationError('Active version has blocking lint errors');
      await validateReferences(tx, input.serviceId, compiled);
      if (input.mode === 'LIVE') {
        const service = await tx.service.findUnique({
          where: { id: input.serviceId },
          select: { escalationPolicyId: true },
        });
        if (service?.escalationPolicyId) {
          try {
            await assertResponderPolicySnapshotSafe(tx, service.escalationPolicyId);
          } catch (error) {
            throw new AutomationValidationError(
              `Service default escalation policy is unsafe for LIVE automation: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        const evidence = await tx.automationShadowAggregate.aggregate({
          where: {
            serviceId: input.serviceId,
            versionId: config.activeVersion.id,
            bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
          },
          _sum: { evaluated: true, errors: true, fallbacks: true },
        });
        if (!evidence._sum.evaluated && !input.acknowledgeNoShadow)
          throw new AutomationValidationError(
            'Acknowledge activation without Shadow traffic for this published version.'
          );
        if ((evidence._sum.errors || evidence._sum.fallbacks) && !input.acknowledgeShadowErrors)
          throw new AutomationValidationError(
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
      { mode: input.mode, versionId: updated.activeVersionId },
      apiClientId
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
        },
        apiClientId
      );
    logger.info('automation.mode.change.staged', {
      serviceId: input.serviceId,
      mode: input.mode,
      versionId: updated.activeVersionId,
    });
    return updated;
  };
  return externalTx ? run(externalTx) : runSerializableTransaction(run);
}
