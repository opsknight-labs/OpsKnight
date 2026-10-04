import { z } from 'zod';
import { RUNBOOK_CONDITION_OPERATORS } from './types';

export const CONDITION_CONTEXT_FIELDS = [
  'incident.id',
  'incident.title',
  'incident.description',
  'incident.status',
  'incident.urgency',
  'incident.priority',
  'incident.tags',
  'service.id',
  'service.name',
  'service.teamId',
] as const;

export function canonicalConditionField(field: string): string {
  return ['priority', 'urgency', 'status', 'title', 'description', 'tags'].includes(field)
    ? `incident.${field}`
    : field;
}

export const conditionOperatorSchema = z.enum(RUNBOOK_CONDITION_OPERATORS);
export const conditionContextFieldSchema = z.enum(CONDITION_CONTEXT_FIELDS);
export const workflowConditionSchema = z.object({
  field: z
    .string()
    .transform(canonicalConditionField)
    .refine(
      field =>
        conditionContextFieldSchema.safeParse(field).success || /^input\.[a-z0-9_]+$/.test(field),
      'Unsupported CONDITION field'
    ),
  operator: conditionOperatorSchema.default('EQUALS'),
  value: z.unknown().optional(),
});
