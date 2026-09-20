import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import prismaClient from '../../prisma';
import type { EvidencePackageScope, EvidenceSelection, ExportPackagePreview } from './types';
import { resolveExportScope } from './scope';
import { buildAuditSnapshot } from './snapshot';
import { collectExportEvidence } from './evidence';
import { buildEvidencePackageZip, type GeneratedPackageResult } from './zip';

export async function exportComplianceEvidencePackage(params: {
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly userId: string;
  readonly now?: Date;
  readonly prisma?: PrismaClient;
}): Promise<GeneratedPackageResult> {
  const prisma = params.prisma ?? prismaClient;
  const snapshotAt = params.now ?? new Date();

  const resolvedScope = resolveExportScope(params.scope);
  const controlIds = resolvedScope.controls.map(c => c.id);

  const snapshot = await buildAuditSnapshot(resolvedScope, snapshotAt, prisma);
  const collectedEvidence = await collectExportEvidence(
    controlIds,
    params.evidenceSelection,
    snapshotAt,
    prisma,
    snapshot.evaluations
  );

  const packageId = `pkg_${randomUUID()}`;

  return buildEvidencePackageZip({
    packageId,
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    snapshot,
    evidence: collectedEvidence,
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
  const snapshotAt = params.now ?? new Date();
  const snapshotAtIso = snapshotAt.toISOString();

  const resolvedScope = resolveExportScope(params.scope);
  const controlIds = resolvedScope.controls.map(c => c.id);

  let evidenceCount = 0;

  if (params.evidenceSelection.mode === 'SNAPSHOT') {
    const states = await prisma.complianceControlState.findMany({
      where: {
        controlId: { in: controlIds },
        evaluatedAt: { lte: snapshotAt },
      },
      select: { latestEvaluationId: true },
    });
    const evalIds = states.map(s => s.latestEvaluationId).filter((id): id is string => Boolean(id));

    if (evalIds.length > 0) {
      evidenceCount = await prisma.complianceEvidence.count({
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

    evidenceCount = await prisma.complianceEvidence.count({
      where: {
        controlId: { in: controlIds },
        observedAt: { gte: fromDate, lte: effectiveTo },
        collectedAt: { lte: snapshotAt },
      },
    });
  }

  const controlsCount = resolvedScope.controls.length;
  const requirementsCount = resolvedScope.requirements.length;

  const estimatedSizeBytes =
    controlsCount * 2500 + requirementsCount * 1200 + evidenceCount * 1500 + 8192;

  return {
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    snapshotAt: snapshotAtIso,
    counts: {
      controls: controlsCount,
      requirements: requirementsCount,
      evidence: evidenceCount,
    },
    estimatedSizeBytes,
  };
}
