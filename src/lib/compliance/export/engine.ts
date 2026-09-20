import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import prismaClient from '../../prisma';
import type { EvidencePackageScope, EvidenceSelection, ExportPackagePreview } from './types';
import { resolveExportScope } from './scope';
import { buildAuditSnapshot, type AuditSnapshotData } from './snapshot';
import { collectExportEvidence, type CollectedExportEvidence } from './evidence';
import { buildEvidencePackageZip, type GeneratedPackageResult } from './zip';

async function getDatabaseSnapshotTimestamp(
  tx: Prisma.TransactionClient | PrismaClient
): Promise<Date> {
  try {
    if ('$queryRaw' in tx && typeof tx.$queryRaw === 'function') {
      const result = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() as now`;
      if (result && result[0]?.now) {
        return new Date(result[0].now);
      }
    }
  } catch {
    // Fall back to host clock if query fails or in non-Postgres/mock environment
  }
  return new Date();
}

export async function exportComplianceEvidencePackage(params: {
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly userId: string;
  readonly now?: Date;
  readonly prisma?: PrismaClient;
}): Promise<GeneratedPackageResult> {
  const prisma = params.prisma ?? prismaClient;
  const resolvedScope = resolveExportScope(params.scope);
  const controlIds = resolvedScope.controls.map(c => c.id);

  const captureData = async (
    tx: Prisma.TransactionClient | PrismaClient
  ): Promise<{
    snapshot: AuditSnapshotData;
    collectedEvidence: CollectedExportEvidence;
  }> => {
    const snapshotAt = params.now ?? (await getDatabaseSnapshotTimestamp(tx));
    const snapshot = await buildAuditSnapshot(resolvedScope, snapshotAt, tx);
    const collectedEvidence = await collectExportEvidence(
      controlIds,
      params.evidenceSelection,
      snapshotAt,
      tx,
      snapshot.evaluations
    );
    return { snapshot, collectedEvidence };
  };

  const captured =
    typeof prisma.$transaction === 'function'
      ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => captureData(tx), {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        })
      : await captureData(prisma);

  const packageId = `pkg_${randomUUID()}`;

  return buildEvidencePackageZip({
    packageId,
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    snapshot: captured.snapshot,
    evidence: captured.collectedEvidence,
    userId: params.userId,
  });
}

export async function previewComplianceEvidencePackage(params: {
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly now?: Date;
  readonly prisma?: PrismaClient;
}): Promise<ExportPackagePreview> {
  const prisma = params.prisma ?? prismaClient;
  const resolvedScope = resolveExportScope(params.scope);
  const controlIds = resolvedScope.controls.map(c => c.id);

  const capturePreview = async (
    tx: Prisma.TransactionClient | PrismaClient
  ): Promise<{
    snapshotAt: Date;
    evidenceCount: number;
  }> => {
    const snapshotAt = params.now ?? (await getDatabaseSnapshotTimestamp(tx));
    let evidenceCount = 0;

    if (params.evidenceSelection.mode === 'SNAPSHOT') {
      const snapshot = await buildAuditSnapshot(resolvedScope, snapshotAt, tx);
      const evalIds = snapshot.evaluations.map(e => e.evaluationId);

      if (evalIds.length > 0) {
        evidenceCount = await tx.complianceEvidence.count({
          where: {
            evaluationId: { in: evalIds },
            observedAt: { lte: snapshotAt },
            collectedAt: { lte: snapshotAt },
          },
        });
      }
    } else {
      const fromDate = new Date(params.evidenceSelection.from);
      const toDate = new Date(params.evidenceSelection.to);
      const effectiveTo = toDate.getTime() <= snapshotAt.getTime() ? toDate : snapshotAt;

      evidenceCount = await tx.complianceEvidence.count({
        where: {
          controlId: { in: controlIds },
          observedAt: { gte: fromDate, lte: effectiveTo },
          collectedAt: { lte: snapshotAt },
        },
      });
    }

    return { snapshotAt, evidenceCount };
  };

  const captured =
    typeof prisma.$transaction === 'function'
      ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => capturePreview(tx), {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        })
      : await capturePreview(prisma);

  const controlsCount = resolvedScope.controls.length;
  const requirementsCount = resolvedScope.requirements.length;

  const estimatedSizeBytes =
    controlsCount * 2500 + requirementsCount * 1200 + captured.evidenceCount * 1500 + 8192;

  return {
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    snapshotAt: captured.snapshotAt.toISOString(),
    counts: {
      controls: controlsCount,
      requirements: requirementsCount,
      evidence: captured.evidenceCount,
    },
    estimatedSizeBytes,
  };
}
