import { z } from 'zod';

export function ingestionConfig() {
  return z
    .object({
      mode: z.enum(['sync', 'postgres']).default('sync'),
      concurrency: z.coerce.number().int().min(1).max(32).default(4),
      pollMs: z.coerce.number().int().min(50).max(30000).default(250),
      maxPending: z.coerce.number().int().min(64).max(10000000).default(100000),
      eventsPerMinute: z.coerce.number().int().min(1).max(10000000).default(120),
      integrationPerMinute: z.coerce.number().int().min(1).max(10000000).default(100),
      payloadRetentionHours: z.coerce.number().int().min(1).max(720).default(24),
      maxPendingBytes: z.coerce
        .number()
        .int()
        .min(64 * 256 * 1024)
        .max(Number.MAX_SAFE_INTEGER)
        .default(1024 * 1024 * 1024),
    })
    .parse({
      mode: process.env.OPSKNIGHT_INGESTION_MODE,
      concurrency: process.env.OPSKNIGHT_INGESTION_CONCURRENCY,
      pollMs: process.env.OPSKNIGHT_INGESTION_POLL_MS,
      maxPending: process.env.OPSKNIGHT_INGESTION_MAX_PENDING,
      eventsPerMinute: process.env.OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE,
      integrationPerMinute: process.env.OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE,
      payloadRetentionHours: process.env.OPSKNIGHT_INGESTION_PAYLOAD_RETENTION_HOURS,
      maxPendingBytes: process.env.OPSKNIGHT_INGESTION_MAX_PENDING_BYTES,
    });
}
