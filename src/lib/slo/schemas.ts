import { z } from 'zod/v3';
import { OBJECTIVE_COMPARATORS, OBJECTIVE_WINDOWS } from './types';

export const CREATABLE_SERVICE_OBJECTIVE_METRICS = [
  'UPTIME',
  'AVAILABILITY',
  'MTTA',
  'MTTR',
] as const;

const serviceObjectiveBaseSchema = z.object({
  serviceId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  metricType: z.enum(CREATABLE_SERVICE_OBJECTIVE_METRICS),
  target: z.number().finite().nonnegative(),
  comparator: z.enum(OBJECTIVE_COMPARATORS),
  windowType: z.enum(OBJECTIVE_WINDOWS),
  windowValue: z.number().int().min(1).max(3650).nullable().optional(),
});

function validateWindowAndTarget(
  value: z.infer<typeof serviceObjectiveBaseSchema>,
  context: z.RefinementCtx
) {
  if (value.windowType === 'ROLLING_DAYS' && !value.windowValue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['windowValue'],
      message: 'windowValue is required for ROLLING_DAYS',
    });
  }
  if (['UPTIME', 'AVAILABILITY'].includes(value.metricType) && value.target > 100) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 100,
      inclusive: true,
      type: 'number',
      path: ['target'],
      message: 'Percentage targets cannot exceed 100',
    });
  }
  // A percentage must stay at or above its target and a duration at or below it; the opposite
  // direction counts slow responders as compliant and fast ones as breached.
  const percentMetric = ['UPTIME', 'AVAILABILITY'].includes(value.metricType);
  const expectedComparator = percentMetric ? 'GREATER_THAN_OR_EQUAL' : 'LESS_THAN_OR_EQUAL';
  if (value.comparator !== expectedComparator) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['comparator'],
      message: percentMetric
        ? 'Uptime and availability objectives must use GREATER_THAN_OR_EQUAL'
        : 'MTTA and MTTR objectives must use LESS_THAN_OR_EQUAL',
    });
  }
  if (['UPTIME', 'AVAILABILITY'].includes(value.metricType) && !value.serviceId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceId'],
      message: 'serviceId is required for uptime and availability objectives',
    });
  }
}

export const serviceObjectiveCreateSchema =
  serviceObjectiveBaseSchema.superRefine(validateWindowAndTarget);

export const serviceObjectiveUpdateSchema = serviceObjectiveBaseSchema
  .omit({ metricType: true, serviceId: true })
  .partial();
