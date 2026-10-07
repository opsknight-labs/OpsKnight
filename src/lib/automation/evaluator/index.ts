import { LIMITS, type CompiledSnapshot, type Context } from '../contract';
import { evaluateEnrichment } from './enrich';
import { evaluateRouting } from './route';
/** Pure/replayable result; wall-clock duration belongs to the runtime wrapper. */
export function evaluateAutomation(input: {
  version: CompiledSnapshot;
  initialContext: Context;
  evaluationAt: string;
  guard?: () => void;
}) {
  const guard = input.guard ?? (() => {});
  if (input.version.rules.length > LIMITS.rules) throw new Error('VERSION_INVALID');
  const enrichment = evaluateEnrichment(input.version, input.initialContext, guard);
  const routing = evaluateRouting(input.version, enrichment.context, guard);
  return {
    evaluationAt: input.evaluationAt,
    inputContext: input.initialContext,
    enrichedContext: enrichment.context,
    writes: enrichment.writes,
    tags: enrichment.tags,
    enrichmentRuleResults: enrichment.results,
    routingRuleResults: routing.results,
    outcome: routing.outcome,
    matchedRule: routing.matchedRule,
    supplementalActions: routing.supplementalActions,
    warnings: [] as string[],
  };
}
export type Evaluation = ReturnType<typeof evaluateAutomation>;
