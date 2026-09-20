import type { PrismaClient, ComplianceEvidence } from '@prisma/client';
import prismaClient from '../../prisma';
import { verifyComplianceEvidenceHash } from '../evidence/hash';
import type { EvidenceSelection, ExportedEvidenceRecord } from './types';
import { MAX_EVIDENCE_RECORDS } from './validation';

export class EvidenceExportLimitExceededError extends Error {
  constructor(
    readonly count: number,
    readonly limit: number
  ) {
    super(
      `Evidence package exceeds configured export limit of ${limit} records (found ${count}). Narrow the date range or select fewer controls.`
    );
    this.name = 'EvidenceExportLimitExceededError';
  }
}

export interface CollectedExportEvidence {
  readonly evidenceRecords: readonly ExportedEvidenceRecord[];
  readonly evidenceByControl: ReadonlyMap<string, readonly ExportedEvidenceRecord[]>;
  readonly totalCount: number;
  readonly integrityMismatchesCount: number;
}

export async function collectExportEvidence(
  controlIds: readonly string[],
  selection: EvidenceSelection,
  snapshotAt: Date,
  prisma: Pick<PrismaClient, 'complianceEvidence' | 'complianceControlState'> = prismaClient
): Promise<CollectedExportEvidence> {
  const records: ExportedEvidenceRecord[] = [];
  const byControl = new Map<string, ExportedEvidenceRecord[]>();
  let mismatchesCount = 0;

  for (const id of controlIds) {
    byControl.set(id, []);
  }

  function processRecord(rec: ComplianceEvidence): ExportedEvidenceRecord {
    const integrityValid = verifyComplianceEvidenceHash({
      controlId: rec.controlId,
      evaluationId: rec.evaluationId,
      type: rec.type,
      collectorId: rec.collectorId,
      collectorVersion: rec.collectorVersion,
      title: rec.title,
      description: rec.description,
      resourceType: rec.resourceType,
      resourceId: rec.resourceId,
      observedAt: rec.observedAt,
      collectedAt: rec.collectedAt,
      validUntil: rec.validUntil,
      metadata: (rec.metadata as Record<string, unknown>) ?? {},
      contentHash: rec.contentHash,
    });
    if (!integrityValid) {
      mismatchesCount++;
    }

    const exported: ExportedEvidenceRecord = {
      id: rec.id,
      evaluationId: rec.evaluationId,
      controlId: rec.controlId,
      type: rec.type,
      collectorId: rec.collectorId,
      collectorVersion: rec.collectorVersion,
      title: rec.title,
      description: rec.description,
      resourceType: rec.resourceType,
      resourceId: rec.resourceId,
      observedAt: rec.observedAt.toISOString(),
      collectedAt: rec.collectedAt.toISOString(),
      validUntil: rec.validUntil ? rec.validUntil.toISOString() : null,
      metadata: (rec.metadata as Record<string, unknown>) ?? {},
      contentHash: rec.contentHash,
      integrityValid,
    };

    const list = byControl.get(rec.controlId);
    if (list) {
      list.push(exported);
    }
    return exported;
  }

  if (selection.mode === 'SNAPSHOT') {
    // For each control, fetch latest evaluation evidence (or latest evidence records)
    const states = await prisma.complianceControlState.findMany({
      where: { controlId: { in: [...controlIds] } },
    });
    const stateByControl = new Map(states.map(s => [s.controlId, s]));

    for (const controlId of controlIds) {
      const state = stateByControl.get(controlId);
      let controlEvidence: ComplianceEvidence[] = [];

      if (state?.latestEvaluationId) {
        controlEvidence = await prisma.complianceEvidence.findMany({
          where: {
            controlId,
            evaluationId: state.latestEvaluationId,
            collectedAt: { lte: snapshotAt },
          },
          orderBy: { observedAt: 'desc' },
        });
      }

      // If no evidence found via evaluationId, fallback to latest records for this control
      if (controlEvidence.length === 0) {
        controlEvidence = await prisma.complianceEvidence.findMany({
          where: {
            controlId,
            collectedAt: { lte: snapshotAt },
          },
          orderBy: { observedAt: 'desc' },
          take: 100,
        });
      }

      for (const rec of controlEvidence) {
        records.push(processRecord(rec));
      }
    }
  } else {
    // HISTORICAL mode
    const fromDate = new Date(selection.from);
    const toDate = new Date(selection.to);

    const where = {
      controlId: { in: [...controlIds] },
      observedAt: { gte: fromDate, lte: toDate },
      collectedAt: { lte: snapshotAt },
    };

    const count = await prisma.complianceEvidence.count({ where });
    if (count > MAX_EVIDENCE_RECORDS) {
      throw new EvidenceExportLimitExceededError(count, MAX_EVIDENCE_RECORDS);
    }

    // Cursor-paginated batch retrieval (250 records per page)
    const batchSize = 250;
    let cursor: string | undefined = undefined;

    while (true) {
      const batch: ComplianceEvidence[] = await prisma.complianceEvidence.findMany({
        where,
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) {
        break;
      }

      for (const rec of batch) {
        records.push(processRecord(rec));
      }

      if (batch.length < batchSize) {
        break;
      }

      cursor = batch[batch.length - 1].id;
    }
  }

  return {
    evidenceRecords: records,
    evidenceByControl: byControl,
    totalCount: records.length,
    integrityMismatchesCount: mismatchesCount,
  };
}
