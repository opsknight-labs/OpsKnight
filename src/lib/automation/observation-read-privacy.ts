import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getAutomationSettings } from './settings';

/** Physical cleanup is asynchronous; fresh shared settings fence disclosure immediately.
 * Apply this at the response boundary after loading observations, without a replica-local cache.
 */
export async function readableObservationPreviews<T extends { rawValuePreview: string }>(
  observations: T[],
  canReadSensitive: boolean,
  client: Prisma.TransactionClient = prisma
): Promise<T[]> {
  return canReadSensitive &&
    (await getAutomationSettings(client)).automationStoreObservationPreviews
    ? observations
    : observations.map(observation => ({ ...observation, rawValuePreview: '[redacted]' }));
}
