import type { Prisma, ComplianceEvaluationStatus, ComplianceDriftKind } from '@prisma/client';
import type { ComplianceDetectedDrift, ComplianceObservation } from './types';
import { computeComplianceObservationFingerprint } from './fingerprint';

/**
 * Builds the active deduplication key for an ongoing drift episode.
 * Set while status is OPEN or ACKNOWLEDGED; set to null upon RESOLVED.
 */
export function buildActiveDedupeKey(
  controlId: string,
  kind: ComplianceDriftKind,
  targetStatus?: ComplianceEvaluationStatus | null
): string {
  return `${controlId}:${kind}:${targetStatus ?? 'CURRENT'}`;
}

/**
 * Resolves active drift episodes for a given control and recovery kind.
 * Clears activeDedupeKey to allow future episodes to be created if drift recurs.
 */
export async function resolveActiveDriftEpisodes(
  tx: Prisma.TransactionClient,
  params: {
    controlId: string;
    recoveryKind: ComplianceDriftKind;
    resolutionEvaluationId: string;
    resolvedAt: Date;
    currentStatus: ComplianceEvaluationStatus;
  }
): Promise<number> {
  const activeEvents = await tx.complianceDriftEvent.findMany({
    where: {
      controlId: params.controlId,
      kind: params.recoveryKind,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
  });

  if (activeEvents.length === 0) return 0;

  let resolvedCount = 0;
  for (const event of activeEvents) {
    await tx.complianceDriftEvent.update({
      where: { id: event.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: params.resolvedAt,
        resolutionEvaluationId: params.resolutionEvaluationId,
        currentStatus: params.currentStatus,
        activeDedupeKey: null, // Clear active dedupe key
      },
    });
    resolvedCount++;
  }

  return resolvedCount;
}

/**
 * Applies a detected drift to the database:
 * - If an active episode already exists: updates occurrence count, lastObservedAt, and handles worsening.
 * - If no active episode exists: creates a new OPEN ComplianceDriftEvent with activeDedupeKey.
 */
export async function applyDetectedDrift(
  tx: Prisma.TransactionClient,
  params: {
    controlId: string;
    drift: ComplianceDetectedDrift;
    baselineEvaluationId: string;
    detectedEvaluationId: string;
    observedAt: Date;
    currentObservation: ComplianceObservation;
  }
): Promise<{
  eventId: string;
  isNew: boolean;
  isWorsened: boolean;
  notificationGeneration: number;
}> {
  const activeKey = buildActiveDedupeKey(
    params.controlId,
    params.drift.kind,
    params.drift.currentStatus
  );

  const existingActive = await tx.complianceDriftEvent.findFirst({
    where: {
      controlId: params.controlId,
      kind: params.drift.kind,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
  });

  const fingerprint = computeComplianceObservationFingerprint(params.currentObservation);

  if (existingActive) {
    // Check if worsening (e.g. PARTIAL -> ACTION_REQUIRED)
    const isWorsened =
      existingActive.currentStatus === 'PARTIAL' &&
      params.drift.currentStatus === 'ACTION_REQUIRED';

    const newGeneration = isWorsened
      ? existingActive.notificationGeneration + 1
      : existingActive.notificationGeneration;

    const updated = await tx.complianceDriftEvent.update({
      where: { id: existingActive.id },
      data: {
        lastObservedAt: params.observedAt,
        occurrenceCount: { increment: 1 },
        currentStatus: params.drift.currentStatus ?? existingActive.currentStatus,
        summary: params.drift.summary,
        details: params.drift.details as unknown as Prisma.InputJsonValue,
        notificationGeneration: newGeneration,
        fingerprint,
      },
    });

    return {
      eventId: updated.id,
      isNew: false,
      isWorsened,
      notificationGeneration: newGeneration,
    };
  }

  // Create new active episode
  try {
    const created = await tx.complianceDriftEvent.create({
      data: {
        subjectType: 'COMPLIANCE_CONTROL',
        subjectId: params.controlId,
        controlId: params.controlId,
        kind: params.drift.kind,
        impact: params.drift.impact,
        status: 'OPEN',
        fingerprint,
        activeDedupeKey: activeKey,
        baselineEvaluationId: params.baselineEvaluationId,
        detectedEvaluationId: params.detectedEvaluationId,
        previousStatus: params.drift.previousStatus ?? null,
        currentStatus: params.drift.currentStatus ?? null,
        summary: params.drift.summary,
        details: params.drift.details as unknown as Prisma.InputJsonValue,
        firstDetectedAt: params.observedAt,
        lastObservedAt: params.observedAt,
        occurrenceCount: 1,
        notificationGeneration: 1,
      },
    });

    return {
      eventId: created.id,
      isNew: true,
      isWorsened: false,
      notificationGeneration: 1,
    };
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2002') {
      const existing = await tx.complianceDriftEvent.findUnique({
        where: { activeDedupeKey: activeKey },
      });
      if (existing) {
        return {
          eventId: existing.id,
          isNew: false,
          isWorsened: false,
          notificationGeneration: existing.notificationGeneration,
        };
      }
    }
    throw err;
  }
}
