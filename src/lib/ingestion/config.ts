import { z } from 'zod/v3';
import { resolveIngestionMode } from './mode';

// The schema is immutable; only environment values are read per call.
// Rebuilding all validators on every admission creates avoidable hot-path garbage.
const configSchema = z.object({
  mode: z.enum(['sync', 'postgres']),
  concurrency: z.coerce.number().int().min(1).max(32).default(4),
  maxInFlightRequests: z.coerce.number().int().min(1).max(1024).default(32),
  requestWaitMs: z.coerce.number().int().min(0).max(1000).default(25),
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
});

export const MAX_INFLIGHT_REQUESTS_RANGE = { fallback: 32, min: 1, max: 1024 } as const;
export const REQUEST_WAIT_MS_RANGE = { fallback: 25, min: 0, max: 1000 } as const;

/** Read an integer environment value, clamped to its range; unset or non-numeric uses the fallback. */
export function clampedIntegerEnv(
  raw: string | undefined,
  range: { fallback: number; min: number; max: number }
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, parsed));
}

export function ingestionConfig() {
  return configSchema.parse({
    mode: resolveIngestionMode(process.env.OPSKNIGHT_INGESTION_MODE),
    concurrency: process.env.OPSKNIGHT_INGESTION_CONCURRENCY,
    maxInFlightRequests: clampedIntegerEnv(
      process.env.OPSKNIGHT_INGESTION_MAX_INFLIGHT_REQUESTS,
      MAX_INFLIGHT_REQUESTS_RANGE
    ),
    requestWaitMs: clampedIntegerEnv(
      process.env.OPSKNIGHT_INGESTION_REQUEST_WAIT_MS,
      REQUEST_WAIT_MS_RANGE
    ),
    pollMs: process.env.OPSKNIGHT_INGESTION_POLL_MS,
    maxPending: process.env.OPSKNIGHT_INGESTION_MAX_PENDING,
    eventsPerMinute: process.env.OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE,
    integrationPerMinute: process.env.OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE,
    payloadRetentionHours: process.env.OPSKNIGHT_INGESTION_PAYLOAD_RETENTION_HOURS,
    maxPendingBytes: process.env.OPSKNIGHT_INGESTION_MAX_PENDING_BYTES,
  });
}
