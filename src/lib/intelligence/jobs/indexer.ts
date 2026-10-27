import 'server-only';
import type { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { buildIncidentFingerprint } from '../normalization';

/**
 * Builds or refreshes the fingerprint for one incident. Read-only with respect to incident data:
 * the only writes are to IncidentFingerprint, and the handler is idempotent so replays are harmless.
 */
export async function indexIncident(
  incidentId: string,
  tx: Prisma.TransactionClient
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
    labelSource: payload && typeof payload === 'object' ? (payload.custom_details ?? payload) : null,
  });

  const data = {
    serviceId: incident.serviceId,
    template: fingerprint.template,
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
