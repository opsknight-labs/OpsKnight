import { Prisma, type PrismaClient, type ComplianceEvaluation } from '@prisma/client';
import prismaClient from '../../prisma';
import {
  computeComplianceObservationFingerprint,
  computeFindingSetFingerprint,
  computeEvidenceIntegrityFingerprint,
} from './fingerprint';
import { buildComplianceObservation } from './observation';
import { compareComplianceObservations } from './comparator';
import { applyDetectedDrift, resolveActiveDriftEpisodes } from './episodes';
import { dispatchComplianceDriftNotification } from './notifications';
import { emitAuditEvent } from '../../audit';
import type { ComplianceObservation } from './types';

export interface ProjectDriftResult {
  readonly controlId: string;
  readonly baselineEstablished: boolean;
  readonly evaluationsProcessed: number;
  readonly driftsOpened: number;
  readonly driftsResolved: number;
}

/**
 * Projects compliance drift for a control by draining all unprocessed evaluations
 * against the durable baseline under a PostgreSQL transaction-level advisory lock.
 */
export async function projectControlDrift(params: {
  controlId: string;
  evaluationId?: string;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<ProjectDriftResult> {
  const prisma = params.prisma ?? prismaClient;
  const now = params.now ?? new Date();
  const { controlId } = params;

  return await prisma.$transaction(
    async tx => {
      // 1. Acquire transaction-scoped advisory lock for this controlId
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`compliance-drift:${controlId}`}, 0))`;

      // 2. Load existing baseline
      const baseline = await tx.complianceDriftBaseline.findUnique({
        where: { controlId },
      });

      // 3. If baseline does not exist, establish it from the authoritative evaluation
      if (!baseline) {
        let initialEval: ComplianceEvaluation | null = null;
        if (params.evaluationId) {
          initialEval = await tx.complianceEvaluation.findUnique({
            where: { id: params.evaluationId },
          });
        }
        if (!initialEval) {
          initialEval = await tx.complianceEvaluation.findFirst({
            where: { controlId },
            orderBy: [{ evaluatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          });
        }

        if (!initialEval) {
          // No evaluation exists yet for this control
          return {
            controlId,
            baselineEstablished: false,
            evaluationsProcessed: 0,
            driftsOpened: 0,
            driftsResolved: 0,
          };
        }

        const evidence = await tx.complianceEvidence.findMany({
          where: { evaluationId: initialEval.id },
        });

        const observation = buildComplianceObservation(initialEval, evidence);
        const obsFingerprint = computeComplianceObservationFingerprint(observation);
        const findFingerprint = computeFindingSetFingerprint(observation.findings);
        const evFingerprint = computeEvidenceIntegrityFingerprint(observation.evidenceIntegrity);

        await tx.complianceDriftBaseline.create({
          data: {
            controlId,
            lastEvaluationId: initialEval.id,
            lastEvaluationCreatedAt: initialEval.createdAt,
            lastEvaluatedAt: initialEval.evaluatedAt,
            resolvedStatus: initialEval.status,
            evaluatorId: initialEval.evaluatorId,
            evaluatorVersion: initialEval.evaluatorVersion,
            observationFingerprint: obsFingerprint,
            findingFingerprint: findFingerprint,
            evidenceFingerprint: evFingerprint,
            establishedAt: now,
          },
        });

        return {
          controlId,
          baselineEstablished: true,
          evaluationsProcessed: 1,
          driftsOpened: 0,
          driftsResolved: 0,
        };
      }

      // 4. Baseline exists: query all newer evaluations for this control in deterministic order
      const newerEvaluations = await tx.complianceEvaluation.findMany({
        where: {
          controlId,
          OR: [
            { createdAt: { gt: baseline.lastEvaluationCreatedAt } },
            {
              createdAt: baseline.lastEvaluationCreatedAt,
              id: { gt: baseline.lastEvaluationId },
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      if (newerEvaluations.length === 0) {
        return {
          controlId,
          baselineEstablished: false,
          evaluationsProcessed: 0,
          driftsOpened: 0,
          driftsResolved: 0,
        };
      }

      // 5. Load baseline evaluation to reconstruct previous observation
      const baselineEval = await tx.complianceEvaluation.findUnique({
        where: { id: baseline.lastEvaluationId },
      });

      let currentBaselineObservation: ComplianceObservation;
      if (baselineEval) {
        const baselineEvidence = await tx.complianceEvidence.findMany({
          where: { evaluationId: baselineEval.id },
        });
        currentBaselineObservation = buildComplianceObservation(baselineEval, baselineEvidence);
      } else {
        // Fallback reconstructed observation
        currentBaselineObservation = {
          controlId,
          status: baseline.resolvedStatus,
          evaluatorId: baseline.evaluatorId,
          evaluatorVersion: baseline.evaluatorVersion,
          findings: [],
          evidenceIntegrity: { total: 0, mismatches: 0 },
        };
      }

      let driftsOpened = 0;
      let driftsResolved = 0;
      let previousObs = currentBaselineObservation;
      let lastProcessedEval: ComplianceEvaluation = newerEvaluations[0];

      for (const nextEval of newerEvaluations) {
        const evidence = await tx.complianceEvidence.findMany({
          where: { evaluationId: nextEval.id },
        });
        const currentObs = buildComplianceObservation(nextEval, evidence);

        const detectedDrifts = compareComplianceObservations(previousObs, currentObs);

        for (const drift of detectedDrifts) {
          if (drift.isRecovery && drift.recoveryKind) {
            const resolved = await resolveActiveDriftEpisodes(tx, {
              controlId,
              recoveryKind: drift.recoveryKind,
              resolutionEvaluationId: nextEval.id,
              resolvedAt: nextEval.evaluatedAt,
              currentStatus: nextEval.status,
            });
            if (resolved > 0) {
              driftsResolved += resolved;
              await emitAuditEvent(
                {
                  action: 'COMPLIANCE_DRIFT_RESOLVED',
                  source: 'BACKGROUND',
                  target: { type: 'COMPLIANCE_DRIFT_EVENT', id: controlId },
                  actor: { type: 'SYSTEM' },
                  occurredAt: nextEval.evaluatedAt,
                  metadata: {
                    controlId,
                    recoveryKind: drift.recoveryKind,
                    resolutionEvaluationId: nextEval.id,
                    currentStatus: nextEval.status,
                  },
                },
                tx
              );
            }
          } else {
            const outcome = await applyDetectedDrift(tx, {
              controlId,
              drift,
              baselineEvaluationId: baseline.lastEvaluationId,
              detectedEvaluationId: nextEval.id,
              observedAt: nextEval.evaluatedAt,
              currentObservation: currentObs,
            });

            if (outcome.isNew) {
              driftsOpened++;
              const eventRecord = await tx.complianceDriftEvent.findUnique({
                where: { id: outcome.eventId },
              });
              if (eventRecord) {
                await dispatchComplianceDriftNotification(tx, {
                  driftEvent: eventRecord,
                  generation: outcome.notificationGeneration,
                  now,
                });
              }

              await emitAuditEvent(
                {
                  action: 'COMPLIANCE_DRIFT_DETECTED',
                  source: 'BACKGROUND',
                  target: { type: 'COMPLIANCE_DRIFT_EVENT', id: outcome.eventId },
                  actor: { type: 'SYSTEM' },
                  occurredAt: nextEval.evaluatedAt,
                  metadata: {
                    controlId,
                    kind: drift.kind,
                    impact: drift.impact,
                    status: nextEval.status,
                  },
                },
                tx
              );
            } else if (outcome.isWorsened) {
              const eventRecord = await tx.complianceDriftEvent.findUnique({
                where: { id: outcome.eventId },
              });
              if (eventRecord) {
                await dispatchComplianceDriftNotification(tx, {
                  driftEvent: eventRecord,
                  generation: outcome.notificationGeneration,
                  now,
                });
              }

              await emitAuditEvent(
                {
                  action: 'COMPLIANCE_DRIFT_WORSENED',
                  source: 'BACKGROUND',
                  target: { type: 'COMPLIANCE_DRIFT_EVENT', id: outcome.eventId },
                  actor: { type: 'SYSTEM' },
                  occurredAt: nextEval.evaluatedAt,
                  metadata: {
                    controlId,
                    kind: drift.kind,
                    generation: outcome.notificationGeneration,
                    status: nextEval.status,
                  },
                },
                tx
              );
            }
          }
        }

        previousObs = currentObs;
        lastProcessedEval = nextEval;
      }

      // 6. Advance baseline to the last processed evaluation
      const finalObsFingerprint = computeComplianceObservationFingerprint(previousObs);
      const finalFindFingerprint = computeFindingSetFingerprint(previousObs.findings);
      const finalEvFingerprint = computeEvidenceIntegrityFingerprint(previousObs.evidenceIntegrity);

      await tx.complianceDriftBaseline.update({
        where: { controlId },
        data: {
          lastEvaluationId: lastProcessedEval.id,
          lastEvaluationCreatedAt: lastProcessedEval.createdAt,
          lastEvaluatedAt: lastProcessedEval.evaluatedAt,
          resolvedStatus: lastProcessedEval.status,
          evaluatorId: lastProcessedEval.evaluatorId,
          evaluatorVersion: lastProcessedEval.evaluatorVersion,
          observationFingerprint: finalObsFingerprint,
          findingFingerprint: finalFindFingerprint,
          evidenceFingerprint: finalEvFingerprint,
          updatedAt: now,
        },
      });

      return {
        controlId,
        baselineEstablished: false,
        evaluationsProcessed: newerEvaluations.length,
        driftsOpened,
        driftsResolved,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 30000,
    }
  );
}
