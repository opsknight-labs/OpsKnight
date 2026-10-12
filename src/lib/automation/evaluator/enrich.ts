import type { EvaluationGuard } from './guard';
/* eslint-disable security/detect-object-injection -- Keys are schema-validated or derived from compiled field definitions. */
import { builtinFields, type CompiledSnapshot, type Context, type Scalar } from '../contract';
import { normalizeValue } from '../context/normalize';
import { evaluateConditions } from './conditions';
export function evaluateEnrichment(
  version: CompiledSnapshot,
  initialContext: Context,
  guard: EvaluationGuard
) {
  const context = { ...initialContext };
  const tags = new Set<string>();
  const writes: Array<{ ruleId: string; fieldKey: string; before: unknown; value: Scalar }> = [];
  const results: ReturnType<typeof evaluateConditions>[] = [];
  for (const [ruleIndex, rule] of version.rules.entries()) {
    if (!rule.enabled || rule.phase !== 'ENRICH') continue;
    guard({ phase: 'ENRICHMENT', ruleIndex, conditionIndex: null });
    const result = evaluateConditions(context, rule, conditionIndex =>
      guard({ phase: 'ENRICHMENT', ruleIndex, conditionIndex })
    );
    results.push(result);
    if (result.result !== 'TRUE') continue;
    for (const [actionIndex, action] of rule.actions.entries()) {
      const position = {
        phase: 'ENRICHMENT' as const,
        ruleIndex,
        conditionIndex: null,
        actionIndex,
      };
      guard(position);
      if (action.type === 'ADD_TAG') {
        if (tags.has(action.value)) continue;
        tags.add(action.value);
        writes.push({ ruleId: rule.id, fieldKey: 'tags', before: null, value: action.value });
        guard(position);
        continue;
      }
      if (action.type !== 'SET_PRIORITY' && action.type !== 'SET_CONTEXT')
        throw new Error('VERSION_INVALID');
      const key = action.type === 'SET_PRIORITY' ? 'priority' : action.fieldKey;
      const field = [...builtinFields, ...version.fields].find(f => f.key === key);
      if (!field) throw new Error('VERSION_INVALID');
      const value = normalizeValue(action.value, field);
      if (value.state !== 'RECOGNIZED') throw new Error('VERSION_INVALID');
      writes.push({
        ruleId: rule.id,
        fieldKey: key,
        before: context[key] ?? { state: 'MISSING' },
        value: value.value,
      });
      context[key] = value;
      guard(position);
    }
  }
  return { context, tags: [...tags], writes, results };
}
