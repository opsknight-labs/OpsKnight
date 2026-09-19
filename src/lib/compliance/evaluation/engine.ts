import crypto from 'node:crypto';
import type {
  Prisma,
  ComplianceEvaluation,
  ComplianceControlState,
  AuditEntityType,
} from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import {
  getComplianceControl,
  getRuntimeComplianceControls,
  computeComplianceControlRegistryFingerprint,
} from '../registry';
import { getComplianceEvaluator } from '../evaluators';
import type { ComplianceEvaluatorResult } from '../evaluators/types';
import type {
  EvaluateControlOptions,
  EvaluateControlsOptions,
  EvaluationBatchResult,
} from './types';

export async function evaluateControl(
  options: EvaluateControlOptions
): Promise<{ evaluation: ComplianceEvaluation; controlState: ComplianceControlState }> {
  const { controlId, context, trigger, batchId } = options;

  const control = getComplianceControl(controlId);
  if (!control) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: `Compliance control "${controlId}" not found in registry.`,
    });
  }

  if (control.assessmentMode !== 'RUNTIME' || !control.evaluatorId) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: `Compliance control "${controlId}" has assessmentMode "${control.assessmentMode}" and does not support runtime evaluation.`,
    });
  }

  const evaluator = getComplianceEvaluator(control.evaluatorId);
  if (!evaluator) {
    throw new AppError({
      code: 'INTERNAL_ERROR',
      userMessage: `Evaluator "${control.evaluatorId}" for control "${controlId}" is not registered.`,
    });
  }

  let result: ComplianceEvaluatorResult;
  try {
    result = await evaluator.evaluate(context);
  } catch (err: unknown) {
    logger.error('[Compliance Engine] Evaluator failed unexpectedly', {
      controlId,
      evaluatorId: evaluator.id,
      error: err instanceof Error ? err.message : String(err),
    });

    result = {
      status: 'UNVERIFIED',
      summary: 'Runtime evaluation could not complete.',
      findings: [
        {
          code: 'EVALUATOR_ERROR',
          message: 'Evaluator threw an unhandled runtime error.',
          severity: 'ERROR',
        },
      ],
      evidenceRefs: [],
    };
  }

  // Persist immutable historical evaluation record
  const evaluation = await context.prisma.complianceEvaluation.create({
    data: {
      controlId: control.id,
      status: result.status,
      evaluatorId: evaluator.id,
      evaluatorVersion: evaluator.version,
      summary: result.summary,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      evidenceRefs: result.evidenceRefs as unknown as Prisma.InputJsonValue,
      trigger,
      batchId: batchId ?? null,
      evaluatedAt: context.now,
      validUntil: result.validUntil ?? null,
    },
  });

  // Update current state projection cache with monotonic race protection
  const existingState = await context.prisma.complianceControlState.findUnique({
    where: { controlId: control.id },
  });

  let controlState: ComplianceControlState;
  if (!existingState) {
    controlState = await context.prisma.complianceControlState.create({
      data: {
        controlId: control.id,
        status: result.status,
        latestEvaluationId: evaluation.id,
        evaluatorId: evaluator.id,
        evaluatorVersion: evaluator.version,
        evaluatedAt: context.now,
        validUntil: result.validUntil ?? null,
        summary: result.summary,
      },
    });
  } else if (context.now >= existingState.evaluatedAt) {
    controlState = await context.prisma.complianceControlState.update({
      where: { controlId: control.id },
      data: {
        status: result.status,
        latestEvaluationId: evaluation.id,
        evaluatorId: evaluator.id,
        evaluatorVersion: evaluator.version,
        evaluatedAt: context.now,
        validUntil: result.validUntil ?? null,
        summary: result.summary,
      },
    });
  } else {
    // Stale evaluation resolved after a newer evaluation; retain newer state
    controlState = existingState;
  }

  return { evaluation, controlState };
}

export async function evaluateControls(
  options: EvaluateControlsOptions
): Promise<EvaluationBatchResult> {
  const supportedRuntimeControls = getRuntimeComplianceControls();
  const supportedIds = new Set(supportedRuntimeControls.map(c => c.id));

  let targetControlIds: string[];
  if (options.controlIds && options.controlIds.length > 0) {
    const normalized = Array.from(new Set(options.controlIds.map(id => id.trim())));
    for (const id of normalized) {
      if (!supportedIds.has(id)) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: `Control "${id}" is either unknown or not configured for runtime evaluation.`,
        });
      }
    }
    targetControlIds = normalized;
  } else {
    targetControlIds = supportedRuntimeControls.map(c => c.id);
  }

  const batchId = `eval_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date();
  const controlRegistryFingerprint = computeComplianceControlRegistryFingerprint();

  const context = {
    prisma,
    now,
    controlRegistryFingerprint,
    actor: options.actor ?? null,
  };

  const actorInput = options.actor
    ? {
        type: 'USER' as const,
        id: options.actor.id,
        email: options.actor.email ?? null,
        name: options.actor.name ?? null,
      }
    : { type: 'SYSTEM' as const };

  await emitAuditEvent({
    action: 'COMPLIANCE_EVALUATION_STARTED',
    source: 'API',
    target: { type: 'COMPLIANCE_EVALUATION' as AuditEntityType, id: batchId },
    actor: actorInput,
    metadata: {
      batchId,
      controlCount: targetControlIds.length,
      controlIds: targetControlIds,
      trigger: options.trigger,
    },
  });

  const evaluations: ComplianceEvaluation[] = [];
  const controlStates: ComplianceControlState[] = [];

  try {
    for (const controlId of targetControlIds) {
      const outcome = await evaluateControl({
        controlId,
        context,
        trigger: options.trigger,
        batchId,
      });
      evaluations.push(outcome.evaluation);
      controlStates.push(outcome.controlState);
    }
  } catch (err: unknown) {
    logger.error('[Compliance Engine] Batch evaluation failed fatally', {
      batchId,
      error: err instanceof Error ? err.message : String(err),
    });

    await emitAuditEvent({
      action: 'COMPLIANCE_EVALUATION_FAILED',
      source: 'API',
      target: { type: 'COMPLIANCE_EVALUATION' as AuditEntityType, id: batchId },
      actor: actorInput,
      metadata: {
        batchId,
        error: err instanceof Error ? err.message : 'Unknown evaluation failure',
      },
    });

    throw err;
  }

  const summary = {
    total: evaluations.length,
    implemented: evaluations.filter(e => e.status === 'IMPLEMENTED').length,
    partial: evaluations.filter(e => e.status === 'PARTIAL').length,
    actionRequired: evaluations.filter(e => e.status === 'ACTION_REQUIRED').length,
    unverified: evaluations.filter(e => e.status === 'UNVERIFIED').length,
    notApplicable: evaluations.filter(e => e.status === 'NOT_APPLICABLE').length,
  };

  await emitAuditEvent({
    action: 'COMPLIANCE_EVALUATION_COMPLETED',
    source: 'API',
    target: { type: 'COMPLIANCE_EVALUATION' as AuditEntityType, id: batchId },
    actor: actorInput,
    metadata: {
      batchId,
      summary,
    },
  });

  return {
    batchId,
    evaluatedAt: now,
    evaluations,
    controlStates,
    summary,
  };
}
