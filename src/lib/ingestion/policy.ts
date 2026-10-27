import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ingestionConfig } from './config';
import { ingestionControlSchema, ingestionPolicySchema } from './policy-schema';

/** Shared MVCC policy read: never retain a replica-local policy after an admin change. */
export async function getIngestionPolicy(client: Prisma.TransactionClient = prisma) {
  const row = await client.systemConfig.findUnique({ where: { key: 'ingestion_control' } });
  return parseIngestionPolicy(row?.value);
}

/** Decode a fresh shared row; never cache mutable control or quota policy. */
export function parseIngestionPolicy(value: unknown) {
  const control = ingestionControlSchema.parse(value ?? { paused: false });
  const {
    concurrency,
    pollMs,
    maxPending,
    maxPendingBytes,
    payloadRetentionHours,
    eventsPerMinute,
    integrationPerMinute,
  } = ingestionConfig();
  const defaults = ingestionPolicySchema.parse({
    concurrency,
    pollMs,
    maxPending,
    maxPendingBytes,
    payloadRetentionHours,
  });
  return {
    paused: control.paused,
    revision: control.revision,
    policy: {
      ...(control.policy ?? defaults),
      quotas: control.policy?.quotas ?? {
        eventsPerMinute,
        eventsBurst: eventsPerMinute,
        integrationPerMinute,
        integrationBurst: integrationPerMinute,
      },
    },
  };
}
