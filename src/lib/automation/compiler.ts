/* eslint-disable security/detect-object-injection -- Keys are schema-validated or derived from compiled field definitions. */
import { snapshotSchema, LIMITS, builtinFields, type CompiledSnapshot } from './contract';
import { compilePath, forbiddenSegment } from './context/extract';
import { normalizeValue, normalizedString } from './context/normalize';
export type LintIssue = {
  level: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  ruleId?: string;
};
export function compileAutomation(raw: unknown): {
  compiled: CompiledSnapshot;
  issues: LintIssue[];
} {
  const snapshot = snapshotSchema.parse(raw);
  const issues: LintIssue[] = [];
  const add = (
    code: string,
    message: string,
    ruleId?: string,
    level: LintIssue['level'] = 'ERROR'
  ) => issues.push({ level, code, message, ruleId });
  const fieldIds = new Set<string>();
  const keys = new Set(builtinFields.map(f => f.key));
  const fields = snapshot.fields.map(field => {
    if (fieldIds.has(field.fieldId)) add('INVALID_FIELD', 'Field identities must be unique');
    fieldIds.add(field.fieldId);
    if (keys.has(field.key) || forbiddenSegment(field.key))
      add('INVALID_FIELD', `Field ${field.key} is reserved, duplicated, or sensitive`);
    keys.add(field.key);
    if (Object.keys(field.aliases).length > LIMITS.aliases) add('ALIAS_LIMIT', 'Too many aliases');
    const aliases: Record<string, string> = {};
    for (const [rawAlias, rawTarget] of Object.entries(field.aliases)) {
      const alias = normalizedString(rawAlias, field),
        target = normalizedString(rawTarget, field);
      if (Object.prototype.hasOwnProperty.call(aliases, alias) && aliases[alias] !== target)
        add('ALIAS_COLLISION', `Alias ${alias} has conflicting targets`);
      aliases[alias] = target;
      if (field.type !== 'ENUM' && field.type !== 'STRING')
        add('INVALID_ALIAS', 'Aliases require text or choice fields');
      if (
        field.type === 'ENUM' &&
        !field.allowedValues?.some(v => normalizedString(v, field) === target)
      )
        add('INVALID_ENUM_TARGET', `Unknown canonical value ${target}`);
    }
    if (field.type === 'ENUM' && !field.allowedValues?.length)
      add('INVALID_ENUM', 'Choice fields need canonical values');
    if (field.type === 'ENUM') {
      const canonicalKeys = field.allowedValues?.map(value => normalizedString(value, field)) ?? [];
      if (new Set(canonicalKeys).size !== canonicalKeys.length)
        add('ENUM_COLLISION', 'Canonical choices must have distinct normalized values');
    }
    return {
      ...field,
      aliases,
      mappings: field.mappings.map(mapping => ({
        ...mapping,
        pathTokens: compilePath(mapping.path),
      })),
    };
  });
  const definitions = [...builtinFields, ...fields];
  const ruleIds = new Set<string>();
  let catchAll = false;
  let priorityWriter = false;
  for (const rule of snapshot.rules) {
    if (ruleIds.has(rule.id)) add('DUPLICATE_RULE', 'Rule IDs must be unique', rule.id);
    ruleIds.add(rule.id);
    for (const condition of rule.conditions) {
      const field = definitions.find(f => f.key === condition.fieldKey);
      if (!field) {
        add('INVALID_FIELD', `Unknown field ${condition.fieldKey}`, rule.id);
        continue;
      }
      const unary = condition.operator.startsWith('IS_');
      if (!unary && condition.value === undefined)
        add('INVALID_VALUE', 'Comparison requires a value', rule.id);
      if (unary && condition.value !== undefined)
        add('INVALID_VALUE', 'Presence operators do not accept values', rule.id);
      if (
        ['IN', 'NOT_IN'].includes(condition.operator) !== Array.isArray(condition.value) &&
        !unary
      )
        add(
          'INVALID_VALUE',
          'List operators require lists; other operators require scalars',
          rule.id
        );
      if (
        ['LT', 'LTE', 'GT', 'GTE'].includes(condition.operator) &&
        (field.type !== 'NUMBER' || typeof condition.value !== 'number')
      )
        add('INVALID_OPERATOR', 'Ordered comparisons require numbers', rule.id);
      if (!unary)
        for (const value of Array.isArray(condition.value) ? condition.value : [condition.value]) {
          const normalized = normalizeValue(value, field);
          if (normalized.state !== 'RECOGNIZED')
            add('INVALID_VALUE', 'Condition value is not canonical', rule.id);
          else if (normalized.value !== value)
            add('NON_CANONICAL_VALUE', 'Use canonical condition values', rule.id);
        }
    }
    const routes = rule.actions.filter(a =>
      ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION'].includes(a.type)
    );
    if (rule.phase === 'ROUTE' && routes.length !== 1)
      add('ROUTE_ACTION_COUNT', 'Routing rules require exactly one responder route', rule.id);
    for (const action of rule.actions) {
      if (
        rule.phase === 'ENRICH' &&
        !['SET_PRIORITY', 'SET_CONTEXT', 'ADD_TAG'].includes(action.type)
      )
        add('INVALID_ACTION', 'Action is not allowed in enrichment', rule.id);
      if (
        rule.phase === 'ROUTE' &&
        ['SET_PRIORITY', 'SET_CONTEXT', 'ADD_TAG'].includes(action.type)
      )
        add('INVALID_ACTION', 'Action is not allowed in routing', rule.id);
      if (action.type === 'SET_CONTEXT') {
        const field = fields.find(f => f.key === action.fieldKey);
        if (!field || normalizeValue(action.value, field).state !== 'RECOGNIZED')
          add(
            'INVALID_CONTEXT_TARGET',
            'Context writes require a declared field and canonical value',
            rule.id
          );
      }
      if (action.type === 'SET_PRIORITY') {
        if (priorityWriter)
          add(
            'PRIORITY_CONFLICT',
            'Multiple priority writers use last writer wins',
            rule.id,
            'WARNING'
          );
        priorityWriter = true;
      }
    }
    if (!rule.enabled) continue;
    if (rule.phase === 'ROUTE') {
      if (catchAll)
        add(
          'SHADOWED_RULE',
          'An earlier unconditional rule prevents this rule from running',
          rule.id,
          'WARNING'
        );
      if (!rule.conditions.length) {
        catchAll = true;
        if (routes.some(a => a.type === 'NO_ESCALATION'))
          add('CATCH_ALL_NO_ESCALATION', 'Unconditional no escalation is prohibited', rule.id);
      }
    }
  }
  const used = new Set(snapshot.rules.flatMap(r => r.conditions.map(c => c.fieldKey)));
  for (const field of fields)
    if (!used.has(field.key))
      add('UNUSED_FIELD', `Field ${field.label} is unused`, undefined, 'WARNING');
  if (snapshot.rules.length > 50)
    add(
      'COMPLEX_POLICY',
      'Review rule ordering carefully for this large policy',
      undefined,
      'WARNING'
    );
  return { compiled: { ...snapshot, fields }, issues };
}
