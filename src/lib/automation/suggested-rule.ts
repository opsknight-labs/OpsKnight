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
  if (open.suggestion) params.set(SUGGESTED_RULE_PARAM, JSON.stringify(open.suggestion));
  return `/services/${encodeURIComponent(serviceId)}?${params.toString()}`;
}

/** The workspace link for a suggestion, or undefined when it would be too long to carry. */
export function suggestedRuleHref(serviceId: string, suggestion: SuggestedRule): string | undefined {
  const href = automationHref(serviceId, { suggestion });
  return href.length <= MAX_HREF ? href : undefined;
}

export function parseSuggestedRule(raw: string | null | undefined): SuggestedRule | null {
  if (!raw || raw.length > 2_000) return null;
  try {
    const parsed = suggestedRuleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
