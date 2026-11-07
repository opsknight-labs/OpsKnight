import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { buildIncidentFingerprint } from '../normalization';
import { indexAlertInputs } from './alert-indexer';
import { stableAnalysisHash } from './input-hash';
import { redactSecrets } from '../ai/redact';
import { updateOutcomePattern } from '../learning/patterns';

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
  options: {
    suppressed?: boolean;
    force?: boolean;
    policy?: { id: string | null; version: number; mode: string };
  } = {}
): Promise<'indexed' | 'unchanged' | 'missing'> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-fingerprint:${incidentId}`}, 0))`;
  const previous = await tx.incidentFingerprint.findUnique({ where: { incidentId } });
  const incident = await tx.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      serviceId: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      status: true,
      urgency: true,
      priority: true,
      teamId: true,
      assigneeId: true,
      resolutionKind: true,
    },
  });
  if (!incident) return 'missing';

  if (options.suppressed) {
    await tx.alertFingerprint.deleteMany({ where: { incidentId } });
    const placeholder = {
      lastIndexedAlertId: null,
      lastIndexedAlertAt: null,
      lastModifiedAlertId: null,
      lastModifiedAlertAt: null,
      alertInputDigest: null,
      indexedAlertCount: null,
      alertNormalizationHash: null,
      analysisInputHash: null,
      serviceId: incident.serviceId,
      sourceUpdatedAt: incident.updatedAt,
      template: '',
      tokens: [],
      labels: {},
      templateHash: null,
      engineVersion: INTELLIGENCE_ENGINE_VERSION,
      incidentCreatedAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      resolutionSummary: null,
      patternVersion: 0,
    };
    await updateOutcomePattern(tx, previous, placeholder);
    await tx.incidentFingerprint.upsert({
      where: { incidentId },
      create: { incidentId, ...placeholder },
      update: placeholder,
    });
    return 'indexed';
  }

  // Establish the derived parent before writing alert fingerprints. Everything is in the same
  // transaction, so neither a partial alert index nor this placeholder survives a failed pass.
  if (!previous)
    await tx.incidentFingerprint.create({
      data: {
        incidentId,
        serviceId: incident.serviceId,
        incidentCreatedAt: incident.createdAt,
        template: '',
        tokens: [],
        labels: {},
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
      },
    });
  const alertInputs = await indexAlertInputs(tx, incident, previous, { force: options.force });
  const [postmortem, resolution] = await Promise.all([
    incident.status === 'RESOLVED'
      ? tx.postmortem.findUnique({ where: { incidentId }, select: { resolution: true } })
      : Promise.resolve(null),
    incident.status === 'RESOLVED'
      ? tx.incidentEvent.findFirst({
          where: { incidentId, type: { in: ['MANUAL_RESOLVED', 'AUTO_RESOLVED'] } },
          orderBy: { createdAt: 'desc' },
          select: { message: true },
        })
      : Promise.resolve(null),
  ]);
  const fingerprint = buildIncidentFingerprint({
    title: incident.title,
    description: incident.description,
  });
  fingerprint.labels = alertInputs.labels;
  const resolutionSummary =
    incident.status === 'RESOLVED'
      ? redactSecrets(postmortem?.resolution || resolution?.message || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 512) || null
      : null;
  const analysisInputHash = stableAnalysisHash({
    title: incident.title,
    description: incident.description,
    serviceId: incident.serviceId,
    status: incident.status,
    urgency: incident.urgency,
    priority: incident.priority,
    teamId: incident.teamId,
    assigneeId: incident.assigneeId,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    resolutionKind: incident.resolutionKind,
    resolutionSummary,
    labels: fingerprint.labels,
    alerts: alertInputs.digest,
    policy: options.policy ?? null,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
  });
  if (!options.force && previous?.analysisInputHash === analysisInputHash) {
    // Advance only the consumed source version so reconciliation does not rediscover unrelated edits.
    if (
      previous.sourceUpdatedAt?.getTime() !== incident.updatedAt.getTime() ||
      alertInputs.stateChanged
    ) {
      await tx.incidentFingerprint.update({
        where: { incidentId },
        data: {
          ...alertInputs.state,
          sourceUpdatedAt: incident.updatedAt,
          updatedAt: previous.updatedAt,
        },
      });
      // Completed snapshots of this exact fingerprint are still valid. Carry only their consumed
      // source version forward; never make an older/different analysis appear newly completed.
      await tx.intelligenceAnalysisSnapshot.updateMany({
        where: {
          incidentId,
          sourceUpdatedAt: previous.sourceUpdatedAt,
          fingerprintUpdatedAt: previous.updatedAt,
        },
        data: { sourceUpdatedAt: incident.updatedAt },
      });
    }
    return 'unchanged';
  }

  const data = {
    ...alertInputs.state,
    analysisInputHash,
    serviceId: incident.serviceId,
    sourceUpdatedAt: incident.updatedAt,
    template: fingerprint.template,
    templateHash: fingerprint.template ? templateHash(fingerprint.template) : null,
    tokens: fingerprint.tokens,
    labels: fingerprint.labels,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    incidentCreatedAt: incident.createdAt,
    resolvedAt: incident.status === 'RESOLVED' ? incident.resolvedAt : null,
    resolutionSummary,
    patternVersion: 1,
  };
  await updateOutcomePattern(tx, previous, data);
  await tx.incidentFingerprint.upsert({
    where: { incidentId },
    create: { incidentId, ...data },
    update: data,
  });
  return 'indexed';
}
