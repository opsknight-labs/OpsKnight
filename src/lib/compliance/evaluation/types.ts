import type { ComplianceEvaluation, ComplianceControlState } from '@prisma/client';
import type { ComplianceEvaluationTrigger } from '../types';
import type { ComplianceEvaluationContext, ComplianceEvaluationActor } from '../evaluators/types';

export interface EvaluateControlOptions {
  readonly controlId: string;
  readonly context: ComplianceEvaluationContext;
  readonly trigger: ComplianceEvaluationTrigger;
  readonly batchId?: string;
}

export interface EvaluateControlsOptions {
  readonly controlIds?: readonly string[];
  readonly trigger: ComplianceEvaluationTrigger;
  readonly actor?: ComplianceEvaluationActor | null;
}

export interface EvaluationBatchResult {
  readonly batchId: string;
  readonly evaluatedAt: Date;
  readonly evaluations: readonly ComplianceEvaluation[];
  readonly controlStates: readonly ComplianceControlState[];
  readonly summary: {
    readonly total: number;
    readonly implemented: number;
    readonly partial: number;
    readonly actionRequired: number;
    readonly unverified: number;
    readonly notApplicable: number;
  };
}
