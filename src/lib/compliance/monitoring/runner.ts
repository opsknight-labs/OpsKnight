import { Prisma, type PrismaClient } from '@prisma/client';
import prismaClient from '../../prisma';
import {
  getRuntimeComplianceControls,
  computeComplianceControlRegistryFingerprint,
} from '../registry';
import { getComplianceEvaluator } from '../evaluators';
import { evaluateControl } from '../evaluation/engine';
import { shouldEvaluateControl } from './schedule';
import { projectControlDrift } from '../drift/projector';
import {
  detectFrameworkLifecycleTransitions,
  recordFrameworkLifecycleTransitions,
} from '../drift/framework-lifecycle';
import { getComplianceMonitoringConfig } from './config';
import { emitAuditEvent } from '../../audit';

export interface SweepRunResult {
  readonly monitorRunId: string;
  readonly status: 'COMPLETED' | 'PARTIAL_FAILED' | 'FAILED';
  readonly controlsTargeted: number;
  readonly controlsEvaluated: number;
  readonly controlsFailed: number;
  readonly driftOpened: number;
  readonly driftResolved: number;
  readonly frameworkChanges: number;
}

/**
 * Runs a continuous compliance evaluation sweep.
 * Evaluates all due controls, projects drift, verifies framework lifecycles,
 * and schedules the next cycle.
 */
export async function runComplianceEvaluationSweep(params: {
  monitorRunId: string;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<SweepRunResult> {
  const prisma = params.prisma ?? prismaClient;
  const now = params.now ?? new Date();
  const { monitorRunId } = params;
  const config = getComplianceMonitoringConfig();

  // 1. Mark run as RUNNING
  await prisma.complianceMonitoringRun.update({
    where: { id: monitorRunId },
    data: {
      status: 'RUNNING',
      startedAt: now,
    },
  });

  await emitAuditEvent({
    action: 'COMPLIANCE_MONITORING_RUN_STARTED',
    source: 'BACKGROUND',
    target: { type: 'COMPLIANCE_MONITORING_RUN', id: monitorRunId },
    actor: { type: 'SYSTEM' },
    occurredAt: now,
    metadata: { monitorRunId },
  });

  const runtimeControls = getRuntimeComplianceControls();
  const states = await prisma.complianceControlState.findMany({
    where: { controlId: { in: runtimeControls.map(c => c.id) } },
  });
  const stateByControl = new Map(states.map(s => [s.controlId, s]));

  // 2. Determine due controls
  const dueControls = runtimeControls.filter(control => {
    const state = stateByControl.get(control.id);
    const evaluator = control.evaluatorId ? getComplianceEvaluator(control.evaluatorId) : undefined;
    const { due } = shouldEvaluateControl({
      state,
      evaluator,
      now,
      intervalMinutes: config.intervalMinutes,
    });
    return due;
  });

  await prisma.complianceMonitoringRun.update({
    where: { id: monitorRunId },
    data: { controlsTargeted: dueControls.length },
  });

  let controlsEvaluated = 0;
  let controlsFailed = 0;
  const errors: Array<{ controlId: string; error: string }> = [];
  const evaluatedControlIds: string[] = [];

  const context = {
    prisma,
    now,
    controlRegistryFingerprint: computeComplianceControlRegistryFingerprint(),
    actor: { id: 'SYSTEM' },
  };

  // 3. Evaluate each due control with individual isolation
  for (const control of dueControls) {
    // Check if already evaluated in this batch (idempotent retry guard)
    const existingEval = await prisma.complianceEvaluation.findUnique({
      where: {
        batchId_controlId: {
          batchId: monitorRunId,
          controlId: control.id,
        },
      },
    });

    if (existingEval) {
      controlsEvaluated++;
      evaluatedControlIds.push(control.id);
      continue;
    }

    try {
      await evaluateControl({
        controlId: control.id,
        trigger: 'SCHEDULED',
        batchId: monitorRunId,
        context,
      });
      controlsEvaluated++;
      evaluatedControlIds.push(control.id);
    } catch (err: unknown) {
      controlsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        controlId: control.id,
        error: message.slice(0, 500),
      });
    }
  }

  // 4. Project drift for all evaluated controls
  let driftOpened = 0;
  let driftResolved = 0;
  for (const controlId of evaluatedControlIds) {
    try {
      const outcome = await projectControlDrift({ controlId, prisma, now });
      driftOpened += outcome.driftsOpened;
      driftResolved += outcome.driftsResolved;
    } catch {
      // Individual projector errors are logged and retried by background job queue
    }
  }

  // 5. Detect and record framework requirement lifecycle changes
  let frameworkChanges = 0;
  try {
    const previousRun = await prisma.complianceMonitoringRun.findFirst({
      where: {
        id: { not: monitorRunId },
        status: { in: ['COMPLETED', 'PARTIAL_FAILED'] },
      },
      orderBy: { completedAt: 'desc' },
    });

    const previousTime = previousRun?.startedAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const transitions = detectFrameworkLifecycleTransitions(previousTime, now);

    if (transitions.length > 0) {
      await prisma.$transaction(async tx => {
        frameworkChanges = await recordFrameworkLifecycleTransitions(tx, transitions, now);
      });
    }
  } catch {
    // Framework lifecycle observation error does not fail the run
  }

  // 6. Complete the monitoring run
  const completionStatus =
    controlsFailed === 0 ? 'COMPLETED' : controlsEvaluated > 0 ? 'PARTIAL_FAILED' : 'FAILED';

  const completedAt = new Date();

  await prisma.complianceMonitoringRun.update({
    where: { id: monitorRunId },
    data: {
      status: completionStatus,
      completedAt,
      controlsEvaluated,
      controlsFailed,
      driftOpened,
      driftResolved,
      frameworkChanges,
      errorSummary:
        errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  // 7. Schedule the next monitoring sweep transactionally
  if (config.enabled) {
    const nextScheduledFor = new Date(completedAt.getTime() + config.intervalMinutes * 60 * 1000);

    await prisma.$transaction(async tx => {
      // Check if next is already scheduled
      const existingNext = await tx.complianceMonitoringRun.findFirst({
        where: { status: 'PENDING' },
      });

      if (!existingNext) {
        const nextRun = await tx.complianceMonitoringRun.create({
          data: {
            scheduledFor: nextScheduledFor,
            status: 'PENDING',
          },
        });

        await tx.backgroundJob.create({
          data: {
            type: 'COMPLIANCE_EVALUATION_SWEEP',
            scheduledAt: nextScheduledFor,
            payload: { monitorRunId: nextRun.id },
          },
        });
      }
    });
  }

  await emitAuditEvent({
    action:
      completionStatus === 'COMPLETED'
        ? 'COMPLIANCE_MONITORING_RUN_COMPLETED'
        : 'COMPLIANCE_MONITORING_RUN_FAILED',
    source: 'BACKGROUND',
    target: { type: 'COMPLIANCE_MONITORING_RUN', id: monitorRunId },
    actor: { type: 'SYSTEM' },
    occurredAt: completedAt,
    metadata: {
      monitorRunId,
      status: completionStatus,
      controlsTargeted: dueControls.length,
      controlsEvaluated,
      controlsFailed,
      driftOpened,
      driftResolved,
    },
  });

  return {
    monitorRunId,
    status: completionStatus,
    controlsTargeted: dueControls.length,
    controlsEvaluated,
    controlsFailed,
    driftOpened,
    driftResolved,
    frameworkChanges,
  };
}
