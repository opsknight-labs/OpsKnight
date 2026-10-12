export type EvaluationPosition = {
  phase: 'EXTRACTION' | 'ENRICHMENT' | 'ROUTING';
  ruleIndex: number | null;
  conditionIndex: number | null;
  actionIndex?: number;
};
export type EvaluationGuard = (position?: EvaluationPosition) => void;
