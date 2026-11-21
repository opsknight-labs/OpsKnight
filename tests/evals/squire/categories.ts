/**
 * Categories every Squire evaluation case belongs to, across the three tiers (basic mode, scripted model,
 * live model). The LLM judge grades a live answer against its category's rubric (`judge.ts`).
 */
export const SQUIRE_EVAL_CATEGORIES = [
  'rca',
  'tool-choice',
  'proposal-wanted',
  'proposal-unwanted',
  'multi-turn',
  'injection',
  'permission-scope',
  'data-class',
  'cost-ceiling',
] as const;
export type SquireEvalCategory = (typeof SQUIRE_EVAL_CATEGORIES)[number];
