import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { buildIncidentFingerprint } from '../normalization';

/** Same value the embedder stores as an embedding's source hash: sha256 of the template, 32 hex chars. */
export function templateHash(template: string): string {
  return createHash('sha256').update(template, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Builds or refreshes the fingerprint for one incident. Read-only with respect to incident data:
 * the only writes are to IncidentFingerprint, and the handler is idempotent so replays are harmless.
 * `suppressed` (the effective policy is OFF) stores an empty placeholder instead: it records that the
 * incident was seen, keeps no text, and is never a similarity candidate or sent for embedding.
 */
export async function indexIncident(
  incidentId: string,
  tx: Prisma.TransactionClient,
  options: { suppressed?: boolean } = {}
): Promise<'indexed' | 'missing'> {
  const incident = await tx.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      serviceId: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
  if (!incident) return 'missing';

  if (options.suppressed) {
    const placeholder = {
      serviceId: incident.serviceId,
      template: '',
      tokens: [],
      labels: {},
      templateHash: null,
      engineVersion: INTELLIGENCE_ENGINE_VERSION,
      incidentCreatedAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
    };
    await tx.incidentFingerprint.upsert({
      where: { incidentId },
      create: { incidentId, ...placeholder },
      update: placeholder,
    });
    return 'indexed';
  }

  // The first alert carries the original monitoring labels; later alerts only repeat them.
  const firstAlert = await tx.alert.findFirst({
    where: { incidentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { payload: true },
  });
  const payload = firstAlert?.payload as { custom_details?: unknown } | null | undefined;
  const fingerprint = buildIncidentFingerprint({
    title: incident.title,
    description: incident.description,
    labelSource:
      payload && typeof payload === 'object' ? (payload.custom_details ?? payload) : null,
  });

  const data = {
    serviceId: incident.serviceId,
    template: fingerprint.template,
    templateHash: fingerprint.template ? templateHash(fingerprint.template) : null,
    tokens: fingerprint.tokens,
    labels: fingerprint.labels,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    incidentCreatedAt: incident.createdAt,
    resolvedAt: incident.resolvedAt,
  };
  await tx.incidentFingerprint.upsert({
    where: { incidentId },
    create: { incidentId, ...data },
    update: data,
  });
  return 'indexed';
}
