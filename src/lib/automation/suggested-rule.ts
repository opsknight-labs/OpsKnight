import { z } from 'zod/v3';
import { conditionSchema, PRIORITIES, ruleSchema, type Rule } from './contract';

/**
 * A rule someone else proposed (a mined suggestion or Squire), carried in the automation workspace URL so
 * that opening it saves nothing: the workspace shows it and a person chooses to add it to the draft, then
 * publishes through the usual review with its replay step. Dependency-free apart from zod, for the client.
 */
export const suggestedRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    conditions: z.array(conditionSchema).min(1).max(5),
    priority: z.enum(PRIORITIES).optional(),
    policyId: z.string().min(1).max(100).optional(),
    noEscalation: z.literal(true).optional(),
  })
  .strict()
  .refine(spec => [spec.priority, spec.policyId, spec.noEscalation].filter(Boolean).length === 1, {
    message: 'A suggested rule does exactly one thing',
  });
export type SuggestedRule = z.infer<typeof suggestedRuleSchema>;

export const SUGGESTED_RULE_PARAM = 'suggestedRule';
export const OPEN_RULE_PARAM = 'automationRule';
/** Insight draft links are capped at 300 characters; a suggestion that does not fit gets no link. */
const MAX_HREF = 300;

export function automationHref(
  serviceId: string,
  open: { ruleId?: string; suggestion?: SuggestedRule } = {}
): string {
  const params = new URLSearchParams({ tab: 'automation' });
  if (open.ruleId) params.set(OPEN_RULE_PARAM, open.ruleId);
  if (open.suggestion) params.set(SUGGESTED_RULE_PARAM, encodeSuggestedRule(open.suggestion));
  return `/services/${encodeURIComponent(serviceId)}?${params.toString()}`;
}

/** The workspace link for a suggestion, or undefined when it would be too long to carry. */
export function suggestedRuleHref(
  serviceId: string,
  suggestion: SuggestedRule
): string | undefined {
  const href = automationHref(serviceId, { suggestion });
  return href.length <= MAX_HREF ? href : undefined;
}

/**
 * Compact URL form, so a suggestion fits an insight link: base64url of
 * [[[field, operator, value], ...], action, name?] where action is a priority, {p: policyId} or 0.
 */
export function encodeSuggestedRule(suggestion: SuggestedRule): string {
  const action = suggestion.priority ?? (suggestion.policyId ? { p: suggestion.policyId } : 0);
  const compact: unknown[] = [
    suggestion.conditions.map(c =>
      c.value === undefined ? [c.fieldKey, c.operator] : [c.fieldKey, c.operator, c.value]
    ),
    action,
  ];
  if (suggestion.name !== defaultSuggestionName(suggestion)) compact.push(suggestion.name);
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function parseSuggestedRule(raw: string | null | undefined): SuggestedRule | null {
  if (!raw || raw.length > 2_000) return null;
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    const [conditions, action, name] = JSON.parse(json) as [unknown, unknown, unknown];
    if (!Array.isArray(conditions)) return null;
    const spec = {
      conditions: conditions.map(c =>
        Array.isArray(c)
          ? { fieldKey: c[0], operator: c[1], ...(c.length > 2 ? { value: c[2] } : {}) }
          : c
      ),
      ...(typeof action === 'string'
        ? { priority: action }
        : action && typeof action === 'object' && 'p' in action
          ? { policyId: (action as { p: unknown }).p }
          : action === 0
            ? { noEscalation: true }
            : {}),
    };
    const parsed = suggestedRuleSchema.safeParse({
      ...spec,
      name: typeof name === 'string' ? name : defaultSuggestionName(spec as SuggestedRule),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The name a suggestion gets when nobody named it. */
export function defaultSuggestionName(
  spec: Pick<SuggestedRule, 'conditions' | 'priority' | 'policyId'>
): string {
  const what = spec.priority
    ? `Set ${spec.priority}`
    : spec.policyId
      ? 'Route to a policy'
      : 'Do not escalate';
  return `${what} when ${describeConditions(spec.conditions)}`.slice(0, 100);
}

/** The rule to add to the draft. A priority suggestion enriches; a destination suggestion routes. */
export function ruleFromSuggestion(suggestion: SuggestedRule, id: string): Rule {
  return ruleSchema.parse({
    id,
    name: suggestion.name,
    phase: suggestion.priority ? 'ENRICH' : 'ROUTE',
    enabled: true,
    conditions: suggestion.conditions,
    actions: [
      suggestion.priority
        ? { type: 'SET_PRIORITY', value: suggestion.priority }
        : suggestion.policyId
          ? { type: 'USE_ESCALATION_POLICY', policyId: suggestion.policyId }
          : { type: 'NO_ESCALATION' },
    ],
  });
}

/** "severity is critical and source is db-01", for cards and summaries. */
export function describeConditions(conditions: SuggestedRule['conditions']): string {
  return conditions
    .map(condition => {
      const value = Array.isArray(condition.value)
        ? condition.value.join(', ')
        : String(condition.value ?? '');
      switch (condition.operator) {
        case 'EQ':
          return `${condition.fieldKey} is ${value}`;
        case 'NE':
          return `${condition.fieldKey} is not ${value}`;
        case 'IN':
          return `${condition.fieldKey} is one of ${value}`;
        case 'NOT_IN':
          return `${condition.fieldKey} is none of ${value}`;
        case 'IS_SET':
          return `${condition.fieldKey} is set`;
        case 'IS_MISSING':
          return `${condition.fieldKey} is missing`;
        case 'IS_UNMAPPED':
          return `${condition.fieldKey} is unmapped`;
        default:
          return `${condition.fieldKey} ${condition.operator.toLowerCase()} ${value}`;
      }
    })
    .join(' and ');
}
