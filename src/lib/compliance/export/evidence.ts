import type { PrismaClient, ComplianceEvidence } from '@prisma/client';
import prismaClient from '../../prisma';
import { verifyComplianceEvidenceHash } from '../evidence/hash';
import type { EvidenceSelection, ExportedEvidenceRecord } from './types';
import { MAX_EVIDENCE_RECORDS, MAX_UNCOMPRESSED_PACKAGE_BYTES } from './validation';
import { canonicalSerializeJson } from './serializer';

export class EvidenceExportLimitExceededError extends Error {
  constructor(
    readonly countOrBytes: number,
    readonly limit: number,
    readonly limitType: 'RECORDS' | 'BYTES' = 'RECORDS'
  ) {
    const message =
      limitType === 'BYTES'
        ? `Evidence package uncompressed size exceeds limit of ${Math.round(limit / (1024 * 1024))}MB (reached ${Math.round(countOrBytes / (1024 * 1024))}MB). Narrow the date range or select fewer controls.`
        : `Evidence package exceeds configured export limit of ${limit} records (found ${countOrBytes}). Narrow the date range or select fewer controls.`;
    super(message);
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
  prisma: Pick<
    PrismaClient,
    'complianceEvidence' | 'complianceControlState' | 'complianceEvaluation'
  > = prismaClient,
  snapshotEvaluations?: readonly { readonly controlId: string; readonly evaluationId: string }[]
): Promise<CollectedExportEvidence> {
  const records: ExportedEvidenceRecord[] = [];
  const byControl = new Map<string, ExportedEvidenceRecord[]>();
  let mismatchesCount = 0;
  let collectedBytes = 0;

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

    const recordBytes = canonicalSerializeJson(exported).byteLength;
    collectedBytes += recordBytes;
    if (collectedBytes > MAX_UNCOMPRESSED_PACKAGE_BYTES) {
      throw new EvidenceExportLimitExceededError(
        collectedBytes,
        MAX_UNCOMPRESSED_PACKAGE_BYTES,
        'BYTES'
      );
    }

    const list = byControl.get(rec.controlId);
    if (list) {
      list.push(exported);
    }
    return exported;
  }

  if (selection.mode === 'SNAPSHOT') {
    // Determine the authoritative evaluationId for each control at or before snapshotAt
    const evalIdByControl = new Map<string, string>();

    if (snapshotEvaluations) {
      for (const e of snapshotEvaluations) {
        evalIdByControl.set(e.controlId, e.evaluationId);
      }
    } else {
      const states = await prisma.complianceControlState.findMany({
        where: { controlId: { in: [...controlIds] } },
      });
      for (const s of states) {
        if (s.evaluatedAt <= snapshotAt && s.latestEvaluationId) {
          evalIdByControl.set(s.controlId, s.latestEvaluationId);
        }
      }
      for (const cid of controlIds) {
        if (!evalIdByControl.has(cid)) {
          const histEval = await prisma.complianceEvaluation.findFirst({
            where: {
              controlId: cid,
              evaluatedAt: { lte: snapshotAt },
            },
            orderBy: { evaluatedAt: 'desc' },
          });
          if (histEval) {
            evalIdByControl.set(cid, histEval.id);
          }
        }
      }
    }

    for (const controlId of controlIds) {
      const evaluationId = evalIdByControl.get(controlId);
      if (!evaluationId) {
        // No evaluation exists at or before snapshotAt -> zero supporting evidence
        continue;
      }

      // Query evidence strictly matching this specific evaluation at or before snapshotAt
      const controlEvidence = await prisma.complianceEvidence.findMany({
        where: {
          controlId,
          evaluationId,
          observedAt: { lte: snapshotAt },
          collectedAt: { lte: snapshotAt },
        },
        orderBy: { observedAt: 'desc' },
      });

      // DO NOT FALL BACK TO OLDER EVALUATIONS.
      // If the current evaluation has zero evidence, export zero evidence for this control.
      for (const rec of controlEvidence) {
        records.push(processRecord(rec));
      }
    }
  } else {
    // HISTORICAL mode
    const fromDate = new Date(selection.from);
    const toDate = new Date(selection.to);
    const effectiveTo = toDate.getTime() <= snapshotAt.getTime() ? toDate : snapshotAt;

    const where = {
      controlId: { in: [...controlIds] },
      observedAt: { gte: fromDate, lte: effectiveTo },
      collectedAt: { lte: snapshotAt },
    };

    const count = await prisma.complianceEvidence.count({ where });
    if (count > MAX_EVIDENCE_RECORDS) {
      throw new EvidenceExportLimitExceededError(count, MAX_EVIDENCE_RECORDS, 'RECORDS');
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
