export type EvaluationPosition = {
  phase: 'EXTRACTION' | 'ENRICHMENT' | 'ROUTING';
  ruleIndex: number | null;
  conditionIndex: number | null;
};
export type EvaluationGuard = (position?: EvaluationPosition) => void;
