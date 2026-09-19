import type { ComplianceControlState } from '@prisma/client';
import type { ComplianceControlDefinition, ComplianceRuntimeControlState } from './types';
import { getComplianceEvaluator } from './evaluators';

/**
 * Authoritatively resolves the dynamic runtime state for a compliance control.
 *
 * Enforces:
 * 1. Evaluator version currency (stored evaluatorVersion must match active evaluator code).
 * 2. Time-bounded validity expiration (validUntil <= now falls back to UNVERIFIED).
 * 3. Graceful handling of controls missing cached state.
 */
export function resolveComplianceRuntimeState(
  control: ComplianceControlDefinition,
  state: ComplianceControlState | null | undefined,
  now: Date = new Date()
): ComplianceRuntimeControlState | null {
  if (!state) {
    return null;
  }

  const evaluator = control.evaluatorId ? getComplianceEvaluator(control.evaluatorId) : undefined;

  const isVersionCurrent = Boolean(evaluator && evaluator.version === state.evaluatorVersion);
  const isExpired = Boolean(state.validUntil && state.validUntil <= now);

  if (!isVersionCurrent) {
    return {
      controlId: state.controlId,
      status: 'UNVERIFIED',
      latestEvaluationId: state.latestEvaluationId,
      evaluatorId: state.evaluatorId,
      evaluatorVersion: state.evaluatorVersion,
      evaluatedAt: state.evaluatedAt,
      validUntil: state.validUntil,
      summary: 'Evaluator version changed since last evaluation; re-evaluation required.',
      isVersionCurrent: false,
    };
  }

  if (isExpired) {
    return {
      controlId: state.controlId,
      status: 'UNVERIFIED',
      latestEvaluationId: state.latestEvaluationId,
      evaluatorId: state.evaluatorId,
      evaluatorVersion: state.evaluatorVersion,
      evaluatedAt: state.evaluatedAt,
      validUntil: state.validUntil,
      summary: 'Evaluation validity expired; re-evaluation required.',
      isVersionCurrent: false,
    };
  }

  return {
    controlId: state.controlId,
    status: state.status,
    latestEvaluationId: state.latestEvaluationId,
    evaluatorId: state.evaluatorId,
    evaluatorVersion: state.evaluatorVersion,
    evaluatedAt: state.evaluatedAt,
    validUntil: state.validUntil,
    summary: state.summary,
    isVersionCurrent: true,
  };
}
