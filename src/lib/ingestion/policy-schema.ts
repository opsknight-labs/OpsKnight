import { z } from 'zod';

/** Safe online controls. Transport and database pools remain deployment configuration. */
export const ingestionPolicySchema = z
  .object({
    concurrency: z.number().int().min(1).max(32),
    pollMs: z.number().int().min(50).max(30000),
    maxPending: z.number().int().min(64).max(10000000),
    maxPendingBytes: z
      .number()
      .int()
      .min(64 * 256 * 1024)
      .max(Number.MAX_SAFE_INTEGER),
    payloadRetentionHours: z.number().int().min(1).max(720),
  })
  .strict();

export const ingestionControlSchema = z
  .object({
    paused: z.boolean(),
    revision: z.number().int().nonnegative().default(0),
    policy: ingestionPolicySchema.optional(),
  })
  .strict();

export type IngestionPolicy = z.infer<typeof ingestionPolicySchema>;
