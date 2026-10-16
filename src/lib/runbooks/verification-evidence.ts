import 'server-only';
import type { Prisma } from '@prisma/client';
import { flattenSteps, parseRunbookDefinition, resolveInputTemplates } from './definition';
import { compareEvidence, runbookEvidenceSchema } from './evidence';
import { requiresAgent } from './types';

/** Enqueue inside the state transaction; evidence parsing runs only after it commits. */
export async function enqueueVerificationEvidence(
  tx: Prisma.TransactionClient,
  executionId: string
) {
  // Called only by a successful terminal-state CAS, in that same transaction. A new
  // revision gets its own job; never mutate a previous worker's processing/completed row.
  const execution = await tx.runbookExecution.update({
    where: { id: executionId },
    data: { verificationRevision: { increment: 1 } },
    select: { verificationRevision: true },
  });
  const revision = execution.verificationRevision;
  const id = `runbook-verification:${executionId}:${revision}`;
  await tx.backgroundJob.create({
    data: {
      id,
      type: 'RUNBOOK',
      status: 'PENDING',
      scheduledAt: new Date(),
      maxAttempts: 8,
      payload: { kind: 'FINALIZE_VERIFICATION', executionId, revision },
    },
  });
}

export async function finalizeVerificationEvidence(
  tx: Prisma.TransactionClient,
  executionId: string,
  revision?: number
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-verification:${executionId}`}))`;
  // Serialize the snapshot with late-result recovery before touching step evidence.
  await tx.$executeRaw`SELECT id FROM "RunbookExecution" WHERE id = ${executionId} FOR UPDATE`;
  const execution = await tx.runbookExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: {
      steps: { include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } } },
    },
  });
  if (revision !== undefined && execution.verificationRevision !== revision) return;
  if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(execution.status)) return;
  const version = await tx.runbookVersion.findUnique({ where: { id: execution.runbookVersionId } });
  // These errors are recorded/retried by the durable job worker. Do not include historical input
  // in the error, and never couple a verification failure to authoritative terminal state.
  if (!version) throw new Error('RUNBOOK_VERIFICATION_VERSION_MISSING');
  let definition;
  try {
    definition = parseRunbookDefinition(version.definition);
  } catch {
    throw new Error('RUNBOOK_VERIFICATION_DEFINITION_INVALID');
  }
  for (const action of flattenSteps(definition)) {
    if (!action.verification || action.riskClass === 'READ_ONLY') continue;
    const parent = execution.steps.find(step => step.stepKey === action.key);
    if (!parent) continue;
    const checks = flattenSteps({ steps: action.verification.steps });
    const states = checks.map(check => execution.steps.find(step => step.stepKey === check.key));
    let preState: unknown = parent.attempts[0]?.preState;
    const baseline = runbookEvidenceSchema.safeParse(preState);
    if (baseline.success && action.precheck) {
      const prechecks = flattenSteps({ steps: action.precheck.steps }).map(check =>
        execution.steps.find(step => step.stepKey === check.key)
      );
      let measured = {};
      for (const check of prechecks) {
        const state = runbookEvidenceSchema.safeParse(check?.attempts[0]?.postState);
        if (state.success) measured = { ...measured, ...state.data };
      }
      preState = { ...measured, ...baseline.data };
    }
    let postState = runbookEvidenceSchema.safeParse(parent.attempts[0]?.postState);
    let checksHealthy = true;
    const actionConfig = resolveInputTemplates(
      action.config,
      execution.inputValues as Record<string, unknown>
    ) as Record<string, unknown>;
    for (const check of states) {
      const state = runbookEvidenceSchema.safeParse(check?.attempts[0]?.postState);
      if (check && requiresAgent(check.type) && !state.success) checksHealthy = false;
      if (state.success && postState.success && check) {
        const data = { ...state.data };
        const hasGoal =
          data.serviceState !== undefined ||
          data.containerState !== undefined ||
          data.kubernetesState !== undefined ||
          Boolean(data.ports?.length) ||
          Boolean(data.healthChecks?.length);
        if (data.captureError || (hasGoal && !compareEvidence(preState, data).healthy))
          checksHealthy = false;
        const checkConfig = resolveInputTemplates(
          check.config,
          execution.inputValues as Record<string, unknown>
        ) as Record<string, unknown>;
        if (
          parent.type !== 'SYSTEMD' ||
          check.type !== parent.type ||
          actionConfig.unit !== checkConfig.unit
        )
          delete data.serviceState;
        if (
          parent.type !== 'DOCKER' ||
          check.type !== parent.type ||
          actionConfig.container !== checkConfig.container ||
          (actionConfig.runtime ?? 'docker') !== (checkConfig.runtime ?? 'docker')
        )
          delete data.containerState;
        if (
          parent.type !== 'KUBERNETES' ||
          check.type !== parent.type ||
          actionConfig.namespace !== checkConfig.namespace ||
          actionConfig.resource !== checkConfig.resource ||
          actionConfig.name !== checkConfig.name
        )
          delete data.kubernetesState;
        postState = runbookEvidenceSchema.safeParse({ ...postState.data, ...data });
      }
    }
    const evidence = compareEvidence(preState, postState.success ? postState.data : null);
    const verified =
      execution.status === 'SUCCEEDED' &&
      parent.status === 'SUCCEEDED' &&
      states.length > 0 &&
      states.every(step => step?.status === 'SUCCEEDED') &&
      checksHealthy &&
      evidence.healthy;
    await tx.runbookExecutionStep.update({
      where: { id: parent.id },
      data: {
        verificationResult: {
          verified,
          checkKeys: checks.map(check => check.key),
          capturedAt: (execution.completedAt ?? execution.updatedAt).toISOString(),
          reason: verified
            ? 'Action, authored checks and post-state passed.'
            : 'Successful command alone does not prove recovery.',
          differences: evidence.differences,
        },
      },
    });
  }
}
