import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { getIngestionAutomationConfig } from '@/lib/automation/settings';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { eventDedupKey } from '@/lib/incidents/event-identity';
import { sanitizeProviderData } from '@/lib/integrations/payload-security';
import { acceptPostgresEvent, prepareIngestionOrdering } from './postgres';
import {
  decodeEnvelope,
  digest,
  encodeEnvelope,
  orderingKeys,
  StoredEnvelope,
  IngestionPayloadError,
} from './contract';

/** Atomic child admission with one immutable copy of the webhook context. */
export async function acceptPostgresBatch(
  input: Omit<IntegrationEventEnvelope, 'event'>,
  events: IntegrationEventEnvelope['event'][],
  deliveryKeys: Array<string | undefined>
) {
  if (!events.length) return [];
  if (events.length > 10000 || events.length !== deliveryKeys.length)
    throw new IngestionPayloadError('Invalid ingestion batch');
  const providerPayload = sanitizeProviderData(input.providerPayload) ?? null;
  const serialized = JSON.stringify(providerPayload);
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024)
    throw new IngestionPayloadError('Shared provider payload exceeds 2 MiB');
  const providerPayloadDigest = digest(providerPayload);
  const children = events.map(event => {
    const details = event.payload.custom_details;
    const restoreBatchAlerts =
      input.integrationType === 'PROMETHEUS' &&
      details !== null &&
      typeof details === 'object' &&
      !Array.isArray(details) &&
      'allAlerts' in details;
    const compactDetails = restoreBatchAlerts
      ? Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'allAlerts'))
      : details;
    return {
      restoreBatchAlerts,
      envelope: {
        ...input,
        providerPayload: null,
        event: {
          ...event,
          dedup_key: event.dedup_key.trim() || eventDedupKey(event.dedup_key, event.payload),
          payload: { ...event.payload, custom_details: compactDetails },
        },
      },
    };
  });
  // Validate before opening a transaction; a late invalid child must not leave a prefix accepted.
  const identities = [
    ...new Set(children.flatMap(child => orderingKeys(encodeEnvelope(child.envelope)))),
  ].sort();
  await prepareIngestionOrdering();
  const committed = await runReadCommittedTransaction(async tx => {
    const counts = { created: 0, duplicate: 0 };
    await tx.$executeRaw`SET LOCAL synchronous_commit = on`;
    for (const identity of identities)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ingestion:${identity}`}, 0))`;
    const batchId = randomUUID();
    await tx.ingestionBatch.create({
      data: {
        id: batchId,
        serviceId: input.serviceId,
        integrationId: input.integrationId,
        payload: { value: providerPayload } as Prisma.InputJsonValue,
      },
    });
    const automationSnapshot = await getIngestionAutomationConfig(tx, input.serviceId);
    const results = [];
    for (const [index, child] of children.entries()) {
      results.push(
        await acceptPostgresEvent(child.envelope, deliveryKeys.at(index), {
          tx,
          shared: {
            batchPayloadId: batchId,
            providerPayloadDigest,
            restoreBatchAlerts: child.restoreBatchAlerts,
          },
          // Conservatively charge shared bytes to each unfinished reference. This
          // bounds unfinished referenced context even after sibling completion.
          providerBytes: Buffer.byteLength(serialized),
          automationSnapshot,
          counts,
          // Older releases stored full per-child context. Only calculate this
          // expensive fallback when an existing delivery hash needs comparison.
          legacyContentHash: () => {
            const {
              receivedAt: _receivedAt,
              automationSnapshot: _automationSnapshot,
              ...content
            } = encodeEnvelope({ ...input, event: events.at(index)! });
            return digest(content);
          },
        })
      );
    }
    // A completely duplicate delivery reuses its previous receipts and payload.
    if (!(await tx.ingestionReceipt.count({ where: { batchId } })))
      await tx.ingestionBatch.delete({ where: { id: batchId } });
    return { results, counts };
  });
  for (const [outcome, count] of [
    ['new', committed.counts.created],
    ['duplicate', committed.counts.duplicate],
  ] as const)
    if (count) addOperationalMetric('opsknight_ingestion_acceptance_total', count, { outcome });
  return committed.results;
}

export async function decodeReceiptEnvelope(value: unknown) {
  const stored = StoredEnvelope.parse(value);
  const envelope = decodeEnvelope(stored);
  if (!stored.batchPayloadId) return envelope;
  const batch = await prisma.ingestionBatch.findFirst({
    where: {
      id: stored.batchPayloadId,
      serviceId: stored.serviceId,
      integrationId: stored.integrationId,
    },
  });
  const providerPayload =
    batch?.payload && typeof batch.payload === 'object' && !Array.isArray(batch.payload)
      ? batch.payload.value
      : undefined;
  if (
    !batch ||
    providerPayload === undefined ||
    digest(providerPayload) !== stored.providerPayloadDigest
  )
    throw new IngestionPayloadError('Shared provider payload is missing or corrupted');
  envelope.providerPayload = providerPayload;
  if (stored.restoreBatchAlerts) {
    const provider = providerPayload;
    if (
      !provider ||
      typeof provider !== 'object' ||
      Array.isArray(provider) ||
      !('alerts' in provider)
    )
      throw new IngestionPayloadError('Shared provider alerts are invalid');
    const details = envelope.event.payload.custom_details;
    if (!details || typeof details !== 'object' || Array.isArray(details))
      throw new IngestionPayloadError('Normalized batch context is invalid');
    envelope.event.payload.custom_details = { ...details, allAlerts: provider.alerts };
  }
  return envelope;
}
