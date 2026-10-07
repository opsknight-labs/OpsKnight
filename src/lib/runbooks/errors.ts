/**
 * OpsKnight Runbooks — Domain-specific error classes.
 *
 * Error hierarchy follows the existing AppError pattern used throughout OpsKnight.
 * Each error class carries structured metadata that API handlers can serialize
 * and UI components can use for targeted messaging.
 */

import { AppError } from '@/lib/errors';
import type { AppErrorCode } from '@/lib/errors/registry';

// ---------------------------------------------------------------------------
// Base Runbook Error
// ---------------------------------------------------------------------------

export class RunbookError extends AppError {
  constructor(input: {
    code: AppErrorCode;
    userMessage: string;
    details?: Record<string, unknown>;
  }) {
    super(input);
    this.name = 'RunbookError';
  }
}

// ---------------------------------------------------------------------------
// Definition / Validation Errors
// ---------------------------------------------------------------------------

export class RunbookDefinitionError extends RunbookError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'RUNBOOK_DEFINITION_INVALID',
      userMessage: message,
      details,
    });
    this.name = 'RunbookDefinitionError';
  }
}

export class RunbookStepKeyDuplicateError extends RunbookError {
  constructor(key: string) {
    super({
      code: 'RUNBOOK_STEP_KEY_DUPLICATE',
      userMessage: `Duplicate step key: "${key}". Each step must have a unique key.`,
      details: { key },
    });
    this.name = 'RunbookStepKeyDuplicateError';
  }
}

export class RunbookInputKeyDuplicateError extends RunbookError {
  constructor(key: string) {
    super({
      code: 'RUNBOOK_INPUT_KEY_DUPLICATE',
      userMessage: `Duplicate input key: "${key}". Each input must have a unique key.`,
      details: { key },
    });
    this.name = 'RunbookInputKeyDuplicateError';
  }
}

// ---------------------------------------------------------------------------
// Lifecycle Errors
// ---------------------------------------------------------------------------

export class RunbookNotFoundError extends RunbookError {
  constructor(runbookId: string) {
    super({
      code: 'RUNBOOK_NOT_FOUND',
      userMessage: 'The specified runbook was not found.',
      details: { runbookId },
    });
    this.name = 'RunbookNotFoundError';
  }
}

export class RunbookCannotDeleteError extends RunbookError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super({
      code: 'RUNBOOK_CANNOT_DELETE',
      userMessage: reason,
      details,
    });
    this.name = 'RunbookCannotDeleteError';
  }
}

export class RunbookRestoreError extends RunbookError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'RUNBOOK_RESTORE_ERROR',
      userMessage: message,
      details,
    });
    this.name = 'RunbookRestoreError';
  }
}

export class RunbookArchivedError extends RunbookError {
  constructor(runbookId: string, action: string = 'modify') {
    super({
      code: 'RUNBOOK_ARCHIVED',
      userMessage: `Cannot ${action} an archived runbook. Restore the runbook first.`,
      details: { runbookId, action },
    });
    this.name = 'RunbookArchivedError';
  }
}

// ---------------------------------------------------------------------------
// Version Errors
// ---------------------------------------------------------------------------

export class RunbookVersionNotFoundError extends RunbookError {
  constructor(versionId: string) {
    super({
      code: 'RUNBOOK_VERSION_NOT_FOUND',
      userMessage: 'The specified runbook version was not found.',
      details: { versionId },
    });
    this.name = 'RunbookVersionNotFoundError';
  }
}

export class RunbookVersionImmutableError extends RunbookError {
  constructor(versionId: string, state: string) {
    super({
      code: 'RUNBOOK_VERSION_IMMUTABLE',
      userMessage: `Cannot modify a ${state.toLowerCase()} runbook version. Only DRAFT versions can be edited.`,
      details: { versionId, state },
    });
    this.name = 'RunbookVersionImmutableError';
  }
}

export class RunbookVersionAlreadyPublishedError extends RunbookError {
  constructor(runbookId: string) {
    super({
      code: 'RUNBOOK_VERSION_ALREADY_PUBLISHED',
      userMessage:
        'This runbook already has a published version. Retire the current version first or create a new version.',
      details: { runbookId },
    });
    this.name = 'RunbookVersionAlreadyPublishedError';
  }
}

// ---------------------------------------------------------------------------
// Execution Errors
// ---------------------------------------------------------------------------

export class RunbookExecutionNotFoundError extends RunbookError {
  constructor(executionId: string) {
    super({
      code: 'RUNBOOK_EXECUTION_NOT_FOUND',
      userMessage: 'The specified runbook execution was not found.',
      details: { executionId },
    });
    this.name = 'RunbookExecutionNotFoundError';
  }
}

export class RunbookExecutionAlreadyExistsError extends RunbookError {
  constructor(triggerFingerprint: string) {
    super({
      code: 'RUNBOOK_EXECUTION_DUPLICATE',
      userMessage: 'A runbook execution with this trigger fingerprint already exists.',
      details: { triggerFingerprint },
    });
    this.name = 'RunbookExecutionAlreadyExistsError';
  }
}

export class RunbookExecutionInvalidTransitionError extends RunbookError {
  constructor(executionId: string, from: string, to: string) {
    super({
      code: 'RUNBOOK_EXECUTION_INVALID_TRANSITION',
      userMessage: `Cannot transition execution from ${from} to ${to}.`,
      details: { executionId, from, to },
    });
    this.name = 'RunbookExecutionInvalidTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Agent Errors
// ---------------------------------------------------------------------------

export class RunbookAgentNotFoundError extends RunbookError {
  constructor(agentId: string) {
    super({
      code: 'RUNBOOK_AGENT_NOT_FOUND',
      userMessage: 'The specified agent was not found.',
      details: { agentId },
    });
    this.name = 'RunbookAgentNotFoundError';
  }
}

export class RunbookAgentRevokedError extends RunbookError {
  constructor(agentId: string) {
    super({
      code: 'RUNBOOK_AGENT_REVOKED',
      userMessage: 'This agent has been revoked and cannot process jobs.',
      details: { agentId },
    });
    this.name = 'RunbookAgentRevokedError';
  }
}

export class RunbookAgentLeaseExpiredError extends RunbookError {
  constructor(attemptId: string, agentId: string) {
    super({
      code: 'RUNBOOK_AGENT_LEASE_EXPIRED',
      userMessage: 'The agent lease for this job has expired.',
      details: { attemptId, agentId },
    });
    this.name = 'RunbookAgentLeaseExpiredError';
  }
}

export class RunbookAgentLeaseTokenMismatchError extends RunbookError {
  constructor(attemptId: string) {
    super({
      code: 'RUNBOOK_AGENT_LEASE_TOKEN_MISMATCH',
      userMessage: 'The provided lease token does not match. The job may have been reclaimed.',
      details: { attemptId },
    });
    this.name = 'RunbookAgentLeaseTokenMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Approval Errors
// ---------------------------------------------------------------------------

export class RunbookApprovalPlanChangedError extends RunbookError {
  constructor(attemptId: string) {
    super({
      code: 'RUNBOOK_APPROVAL_PLAN_CHANGED',
      userMessage:
        'The execution plan has changed since approval was granted. A new approval is required.',
      details: { attemptId },
    });
    this.name = 'RunbookApprovalPlanChangedError';
  }
}

// ---------------------------------------------------------------------------
// Policy / Safety Errors
// ---------------------------------------------------------------------------

export class RunbookBlastRadiusExceededError extends RunbookError {
  constructor(limitType: string, current: number, max: number) {
    super({
      code: 'RUNBOOK_BLAST_RADIUS_EXCEEDED',
      userMessage: `Cannot execute: ${limitType} limit reached (${current}/${max}).`,
      details: { limitType, current, max },
    });
    this.name = 'RunbookBlastRadiusExceededError';
  }
}

export class RunbookCircuitBreakerOpenError extends RunbookError {
  constructor(runbookId: string, serviceId: string) {
    super({
      code: 'RUNBOOK_CIRCUIT_BREAKER_OPEN',
      userMessage: 'Automatic execution has been paused because remediation has repeatedly failed.',
      details: { runbookId, serviceId },
    });
    this.name = 'RunbookCircuitBreakerOpenError';
  }
}

export class RunbookSecretNotFoundError extends RunbookError {
  constructor(name: string) {
    super({
      code: 'RUNBOOK_SECRET_NOT_FOUND',
      userMessage: `The referenced secret "${name}" was not found.`,
      details: { name },
    });
    this.name = 'RunbookSecretNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Pre-execution Fence Error
// ---------------------------------------------------------------------------

export class RunbookPreExecutionFenceError extends RunbookError {
  constructor(attemptId: string, reason: string) {
    super({
      code: 'RUNBOOK_PRE_EXECUTION_FENCE_FAILED',
      userMessage: `Pre-execution verification failed: ${reason}`,
      details: { attemptId, reason },
    });
    this.name = 'RunbookPreExecutionFenceError';
  }
}
