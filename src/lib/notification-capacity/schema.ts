import { z } from 'zod';
import { HARD_LIMITS } from './hard-limits';

export const capacityModeSchema = z.enum(['AUTO', 'CUSTOM']);

export const providerCapacityInputSchema = z
  .object({
    provider: z.string().trim().min(1).max(80).toLowerCase(),
    channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP']),
    mode: capacityModeSchema,
    ratePerSecond: z
      .number()
      .int()
      .min(HARD_LIMITS.ratePerSecond.min)
      .max(HARD_LIMITS.ratePerSecond.max)
      .nullable()
      .optional(),
    maxInFlight: z
      .number()
      .int()
      .min(HARD_LIMITS.maxInFlight.min)
      .max(HARD_LIMITS.maxInFlight.max)
      .nullable()
      .optional(),
    bulkSharePercent: z
      .number()
      .int()
      .min(HARD_LIMITS.bulkSharePercent.min)
      .max(HARD_LIMITS.bulkSharePercent.max),
    adaptiveBackpressure: z.boolean(),
    revision: z.number().int().min(1).optional(),
    acknowledgeRisk: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'CUSTOM') {
      if (value.ratePerSecond == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ratePerSecond is required in CUSTOM mode',
          path: ['ratePerSecond'],
        });
      }
      if (value.maxInFlight == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'maxInFlight is required in CUSTOM mode',
          path: ['maxInFlight'],
        });
      }
    }
  });

export const runtimeSettingsInputSchema = z
  .object({
    bulkQueueLowWatermark: z
      .number()
      .int()
      .min(HARD_LIMITS.queueLowWatermark.min)
      .max(HARD_LIMITS.queueLowWatermark.max),
    bulkQueueHighWatermark: z
      .number()
      .int()
      .min(HARD_LIMITS.queueHighWatermark.min)
      .max(HARD_LIMITS.queueHighWatermark.max),
    defaultBulkSharePercent: z
      .number()
      .int()
      .min(HARD_LIMITS.bulkSharePercent.min)
      .max(HARD_LIMITS.bulkSharePercent.max),
    adaptiveBackpressure: z.boolean(),
    revision: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.bulkQueueHighWatermark < value.bulkQueueLowWatermark) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'High watermark must be >= low watermark',
        path: ['bulkQueueHighWatermark'],
      });
    }
  });

export type ProviderCapacityInput = z.infer<typeof providerCapacityInputSchema>;
export type RuntimeSettingsInput = z.infer<typeof runtimeSettingsInputSchema>;
