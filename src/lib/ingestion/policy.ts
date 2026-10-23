import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ingestionConfig } from './config';
import { ingestionControlSchema, ingestionPolicySchema } from './policy-schema';

/** Shared MVCC policy read: never retain a replica-local policy after an admin change. */
export async function getIngestionPolicy(client: Prisma.TransactionClient = prisma) {
  const row = await client.systemConfig.findUnique({ where: { key: 'ingestion_control' } });
  const control = ingestionControlSchema.parse(row?.value ?? { paused: false });
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
