import 'server-only';

import type { IncidentEventType, Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError } from '@/lib/errors';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import {
  HUMAN_INTERVENTION_PREFIX,
  RESOLUTION_RECOMMENDED_PREFIX,
} from '@/lib/incidents/response-presentation';
import { flattenSteps, parseRunbookDefinition } from './definition';
import { verificationResultSchema } from './evidence';
import type { RunbookRecoveryOutcome } from './types';

/** Step statuses showing the write action was actually dispatched. */
const ATTEMPTED_STEP_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'UNKNOWN']);

export interface RecoveryWriteAction {
  key: string;
  name: string;
  hasVerification: boolean;
  /** The action step was dispatched (it ran, failed or has an unknown outcome). */
  attempted: boolean;
  /** `verificationResult.verified === true` persisted by finalizeVerificationEvidence. */
  verified: boolean;
}

export interface RecoveryDecisionInput {
  executionStatus: string;
  incidentId: string | null;
  binding: { enabled: boolean; resolveOnVerifiedRecovery: boolean } | null;
  writeActions: RecoveryWriteAction[];
}

export interface RecoveryDecision {
  outcome: Extract<RunbookRecoveryOutcome, 'PENDING' | 'NOT_VERIFIED' | 'NOT_REQUESTED'>;
  event: Extract<IncidentEventType, 'RUNBOOK_VERIFIED' | 'RUNBOOK_UNVERIFIED'> | null;
  verifiedCount: number;
  writeCount: number;
}

/**
 * Pure recovery policy. Runbook success alone never resolves an incident: every write
 * action must carry passing verification evidence, and READ_ONLY-only runbooks never resolve.
 */
export function decideRecovery(input: RecoveryDecisionInput): RecoveryDecision {
  const writeCount = input.writeActions.length;
  const verifiedCount = input.writeActions.filter(action => action.verified).length;
  const allVerified = writeCount > 0 && verifiedCount === writeCount;
  const reported = input.writeActions.some(action => action.hasVerification && action.attempted);
  const event =
    !input.incidentId || !reported
      ? null
      : allVerified && input.executionStatus === 'SUCCEEDED'
        ? 'RUNBOOK_VERIFIED'
        : 'RUNBOOK_UNVERIFIED';
  let outcome: RecoveryDecision['outcome'];
  if (writeCount === 0) outcome = 'NOT_REQUESTED';
  else if (input.executionStatus !== 'SUCCEEDED' || !allVerified) outcome = 'NOT_VERIFIED';
  else if (input.incidentId && input.binding?.enabled && input.binding.resolveOnVerifiedRecovery)
    outcome = 'PENDING';
  else outcome = 'NOT_REQUESTED';
  return { outcome, event, verifiedCount, writeCount };
}

const recoveryExecutionInclude = {
  runbook: { select: { name: true } },
  runbookVersion: { select: { definition: true } },
  binding: { select: { enabled: true, resolveOnVerifiedRecovery: true } },
  steps: { select: { stepKey: true, status: true, verificationResult: true } },
  incident: {
    select: {
      status: true,
      automationDecision: { select: { mode: true, routeType: true } },
    },
  },
} satisfies Prisma.RunbookExecutionInclude;

type RecoveryExecution = Prisma.RunbookExecutionGetPayload<{
  include: typeof recoveryExecutionInclude;
}>;

function recoveryWriteActions(execution: RecoveryExecution): RecoveryWriteAction[] {
  const definition = parseRunbookDefinition(execution.runbookVersion.definition);
  return flattenSteps(definition)
    .filter(step => step.riskClass !== 'READ_ONLY')
    .map(step => {
      const persisted = execution.steps.find(candidate => candidate.stepKey === step.key);
      const result = verificationResultSchema.safeParse(persisted?.verificationResult);
      return {
        key: step.key,
        name: step.name,
        hasVerification: (step.verification?.steps.length ?? 0) > 0,
        attempted: persisted ? ATTEMPTED_STEP_STATUSES.has(persisted.status) : false,
        verified: result.success && result.data.verified === true,
      };
    });
}

function decisionFor(execution: RecoveryExecution): RecoveryDecision {
  return decideRecovery({
    executionStatus: execution.status,
    incidentId: execution.incidentId,
    binding: execution.binding,
    writeActions: recoveryWriteActions(execution),
  });
}

/**
 * Non-actionable outcomes may be revised: a late Agent result can revive a FAILED
 * (UNKNOWN_OUTCOME) execution, which is then terminalized and recorded again.
 */
const REVISABLE_OUTCOMES = ['NOT_VERIFIED', 'NOT_REQUESTED'] as const;
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);
const OPEN_INCIDENT_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED']);

/** Revisable only after a revived execution was terminalized again (completedAt moved past the check). */
function isRecordable(execution: RecoveryExecution): boolean {
  if (!TERMINAL_STATUSES.has(execution.status)) return false;
  if (execution.recoveryOutcome === null) return true;
  if (!(REVISABLE_OUTCOMES as readonly string[]).includes(execution.recoveryOutcome)) return false;
  return (
    !!execution.completedAt &&
    (!execution.recoveryCheckedAt || execution.completedAt > execution.recoveryCheckedAt)
  );
}

function requiresHumanIntervention(
  execution: RecoveryExecution,
  decision: RecoveryDecision
): boolean {
  const decisionRow = execution.incident?.automationDecision;
  if (decisionRow?.mode !== 'LIVE' || decisionRow.routeType !== 'NO_ESCALATION') return false;
  if (!execution.incident || !OPEN_INCIDENT_STATUSES.has(execution.incident.status)) return false;
  return (
    execution.status === 'FAILED' ||
    execution.status === 'TIMED_OUT' ||
    decision.event === 'RUNBOOK_UNVERIFIED' ||
    (execution.status === 'SUCCEEDED' && decision.outcome === 'NOT_VERIFIED')
  );
}

function verificationMessage(
  execution: RecoveryExecution,
  decision: RecoveryDecision,
  outcome: RunbookRecoveryOutcome
): string {
  const counts = `${decision.verifiedCount}/${decision.writeCount} write actions verified`;
  if (decision.event === 'RUNBOOK_UNVERIFIED')
    return `Recovery not verified: ${execution.runbook.name} (${counts}). The incident stays open and escalation continues.`;
  if (outcome === 'PENDING')
    return `Recovery verified: ${execution.runbook.name} (${counts}). Automatic resolution queued.`;
  if (outcome === 'ALREADY_CLOSED')
    return `Recovery verified: ${execution.runbook.name} (${counts}). The incident was already resolved.`;
  return `Recovery verified: ${execution.runbook.name} (${counts}). ${RESOLUTION_RECOMMENDED_PREFIX}: confirm recovery and resolve the incident.`;
}

/**
 * Called in the same transaction that terminalizes an execution, after
 * finalizeVerificationEvidence. Records the recovery decision, the verification
 * timeline event and, when opted in, the durable VERIFIED_RESOLUTION job.
 * Repeated calls for the same terminalization are no-ops.
 */
export async function recordRecoveryVerification(
  tx: Prisma.TransactionClient,
  executionId: string
): Promise<RecoveryDecision | null> {
  const execution = await tx.runbookExecution.findUnique({
    where: { id: executionId },
    include: recoveryExecutionInclude,
  });
  if (!execution || !isRecordable(execution)) return null;
  const decision = decisionFor(execution);
  const outcome: RunbookRecoveryOutcome =
    execution.incident?.status === 'RESOLVED' ? 'ALREADY_CLOSED' : decision.outcome;
  const now = new Date();
  const checkedAt =
    execution.completedAt && execution.completedAt > now ? execution.completedAt : now;
  // Compare-and-set on the observed outcome so concurrent callers record exactly once.
  const recorded = await tx.runbookExecution.updateMany({
    where: {
      id: executionId,
      recoveryOutcome: execution.recoveryOutcome,
      recoveryCheckedAt: execution.recoveryCheckedAt,
    },
    data: {
      recoveryOutcome: outcome,
      recoveryCheckedAt: outcome === 'PENDING' ? null : checkedAt,
    },
  });
  if (recorded.count !== 1) return null;
  const incidentId = execution.incidentId;
  const humanIntervention = !!incidentId && requiresHumanIntervention(execution, decision);
  if (decision.event && incidentId) {
    const message = verificationMessage(execution, decision, outcome);
    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: decision.event,
        message:
          humanIntervention && decision.event === 'RUNBOOK_UNVERIFIED'
            ? `${HUMAN_INTERVENTION_PREFIX}: no responder is paged for this incident. ${message}`
            : message,
      },
    });
  }
  if (humanIntervention && incidentId && decision.event !== 'RUNBOOK_UNVERIFIED') {
    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'RUNBOOK_UNVERIFIED',
        message: `${HUMAN_INTERVENTION_PREFIX}: no responder is paged for this incident. Runbook ${execution.runbook.name} ${execution.status === 'SUCCEEDED' ? 'completed without verification evidence' : execution.status === 'TIMED_OUT' ? 'timed out' : 'failed'}.`,
      },
    });
  }
  if (outcome === 'PENDING') {
    await tx.backgroundJob.create({
      data: {
        type: 'RUNBOOK',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 8,
        payload: { kind: 'VERIFIED_RESOLUTION', executionId },
      },
    });
  }
  return decision;
}

class RecoveryBlocked extends Error {}

/** A resolve/reopen cycle during or after the run means the evidence belongs to an older episode. */
async function hasConflictingTransition(
  tx: Prisma.TransactionClient,
  incidentId: string,
  since: Date
): Promise<boolean> {
  const conflicting = await tx.incidentEvent.count({
    where: {
      incidentId,
      createdAt: { gt: since },
      type: { in: ['REOPENED', 'MANUAL_RESOLVED', 'AUTO_RESOLVED'] },
    },
  });
  return conflicting > 0;
}

async function resolveVerifiedRecovery(
  tx: Prisma.TransactionClient,
  executionId: string
): Promise<RunbookRecoveryOutcome | null> {
  const execution = await tx.runbookExecution.findUnique({
    where: { id: executionId },
    include: recoveryExecutionInclude,
  });
  if (!execution) return null;
  if (execution.recoveryOutcome !== 'PENDING')
    return execution.recoveryOutcome as RunbookRecoveryOutcome | null;
  // Policy may have changed since the job was enqueued (toggle off, binding disabled).
  const decision = decisionFor(execution);
  let outcome: RunbookRecoveryOutcome = decision.outcome;
  if (decision.outcome === 'PENDING' && execution.incidentId && execution.incident) {
    const status = execution.incident.status;
    if (status === 'RESOLVED') {
      outcome = 'ALREADY_CLOSED';
    } else if (status !== 'OPEN' && status !== 'ACKNOWLEDGED') {
      throw new RecoveryBlocked(`the incident is ${status.toLowerCase()}`);
    } else if (
      await hasConflictingTransition(tx, execution.incidentId, execution.createdAt)
    ) {
      throw new RecoveryBlocked(
        'the incident was resolved or reopened after the runbook started, so the verification is no longer current'
      );
    } else {
      const result = await applyIncidentLifecycleCommand(tx, {
        incidentId: execution.incidentId,
        command: 'RESOLVE',
        source: 'SYSTEM',
        expectedStatus: status,
        eventMessage: `Resolved after verified recovery: ${execution.runbook.name}`,
      });
      outcome = result.changed ? 'RESOLVED' : 'ALREADY_CLOSED';
    }
  } else if (decision.outcome === 'PENDING') {
    outcome = 'ALREADY_CLOSED';
  }
  const recorded = await tx.runbookExecution.updateMany({
    where: { id: executionId, recoveryOutcome: 'PENDING' },
    data: { recoveryOutcome: outcome, recoveryCheckedAt: new Date() },
  });
  if (recorded.count !== 1) throw new Error('Recovery outcome changed concurrently.');
  if (outcome === 'RESOLVED') {
    await logAudit(
      {
        action: 'runbook.execution.recovery.resolved',
        entityType: 'RUNBOOK_EXECUTION',
        entityId: executionId,
        details: { incidentId: execution.incidentId, bindingId: execution.bindingId },
      },
      tx
    );
  }
  return outcome;
}

async function blockVerifiedRecovery(
  tx: Prisma.TransactionClient,
  executionId: string,
  reason: string
): Promise<RunbookRecoveryOutcome | null> {
  const execution = await tx.runbookExecution.findUnique({
    where: { id: executionId },
    select: { recoveryOutcome: true, incidentId: true, runbook: { select: { name: true } } },
  });
  if (!execution || execution.recoveryOutcome !== 'PENDING')
    return (execution?.recoveryOutcome ?? null) as RunbookRecoveryOutcome | null;
  const recorded = await tx.runbookExecution.updateMany({
    where: { id: executionId, recoveryOutcome: 'PENDING' },
    data: { recoveryOutcome: 'BLOCKED', recoveryCheckedAt: new Date() },
  });
  if (recorded.count === 1 && execution.incidentId) {
    await tx.incidentEvent.create({
      data: {
        incidentId: execution.incidentId,
        type: 'RUNBOOK_SKIPPED',
        message: `Automatic resolution blocked after verified recovery (${execution.runbook.name}): ${reason}`,
      },
    });
  }
  return 'BLOCKED';
}

/**
 * VERIFIED_RESOLUTION job handler. Idempotent: only a PENDING outcome is acted on and
 * every precondition is re-checked inside a serializable transaction. Escalation is
 * never paused here; a blocked resolution leaves paging untouched.
 */
export async function processVerifiedResolution(
  executionId: string
): Promise<RunbookRecoveryOutcome | null> {
  try {
    return await runSerializableTransaction(tx => resolveVerifiedRecovery(tx, executionId));
  } catch (error) {
    const reason =
      error instanceof RecoveryBlocked
        ? error.message
        : error instanceof AppError && !error.retryable
          ? error.userMessage
          : null;
    if (reason === null) throw error;
    return runSerializableTransaction(tx => blockVerifiedRecovery(tx, executionId, reason));
  }
}
