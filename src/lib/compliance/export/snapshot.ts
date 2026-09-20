import type { PrismaClient } from '@prisma/client';
import prismaClient from '../../prisma';
import type { ControlFinding } from '../types';
import { resolveComplianceRuntimeState } from '../state';
import { getComplianceEvaluator } from '../evaluators';
import type {
  ExportedControlSnapshot,
  ExportedEvaluationSnapshot,
  ExportedFrameworkDefinition,
  ExportedFrameworkRequirement,
} from './types';
import type { ResolvedExportScope } from './scope';

export interface AuditSnapshotData {
  readonly snapshotAt: string;
  readonly controls: readonly ExportedControlSnapshot[];
  readonly evaluations: readonly ExportedEvaluationSnapshot[];
  readonly frameworks: readonly ExportedFrameworkDefinition[];
  readonly requirements: readonly ExportedFrameworkRequirement[];
  readonly controlEvidenceCounts: ReadonlyMap<string, number>;
}

export async function buildAuditSnapshot(
  scope: ResolvedExportScope,
  snapshotAt: Date = new Date(),
  prisma: Pick<PrismaClient, 'complianceControlState' | 'complianceEvaluation'> = prismaClient
): Promise<AuditSnapshotData> {
  const snapshotAtIso = snapshotAt.toISOString();
  const controlIds = scope.controls.map(c => c.id);

  // 1. Fetch current stored control states
  const states = await prisma.complianceControlState.findMany({
    where: { controlId: { in: controlIds } },
  });
  const stateByControl = new Map(states.map(s => [s.controlId, s]));

  // 2. Fetch latest evaluations referenced by states
  const evaluationIds = states
    .map(s => s.latestEvaluationId)
    .filter((id): id is string => Boolean(id));

  const evaluations =
    evaluationIds.length > 0
      ? await prisma.complianceEvaluation.findMany({
          where: { id: { in: evaluationIds } },
        })
      : [];
  const evalById = new Map(evaluations.map(e => [e.id, e]));

  // 3. Build authoritative control snapshots
  const exportedControls: ExportedControlSnapshot[] = [];
  const exportedEvaluations: ExportedEvaluationSnapshot[] = [];

  for (const control of scope.controls) {
    const rawState = stateByControl.get(control.id);
    const runtimeState = resolveComplianceRuntimeState(control, rawState, snapshotAt);

    let resolvedCurrentState: ExportedControlSnapshot['resolvedCurrentState'];
    let evaluatedAt: string | null = null;
    let validUntil: string | null = null;
    let summary: string | null = null;

    if (control.assessmentMode === 'RUNTIME') {
      if (!runtimeState) {
        resolvedCurrentState = 'ACTION_REQUIRED';
        summary = 'Runtime control not yet evaluated; evaluation required.';
      } else {
        resolvedCurrentState = runtimeState.status;
        evaluatedAt = runtimeState.evaluatedAt ? runtimeState.evaluatedAt.toISOString() : null;
        validUntil = runtimeState.validUntil ? runtimeState.validUntil.toISOString() : null;
        summary = runtimeState.summary;
      }
    } else {
      resolvedCurrentState = (control.catalogStatus ??
        control.status) as ExportedControlSnapshot['resolvedCurrentState'];
      summary = control.description;
    }

    const evaluator = control.evaluatorId
      ? {
          id: control.evaluatorId,
          version: getComplianceEvaluator(control.evaluatorId)?.version ?? 'unknown',
        }
      : null;

    // Associated framework mappings for this control
    const controlMappings = scope.mappings
      .filter(m => m.controlId === control.id)
      .map(m => {
        const req = scope.requirements.find(r => r.id === m.requirementId);
        return {
          framework: m.framework,
          requirementId: m.requirementId,
          reference: req?.reference ?? m.requirementId,
          lifecycle: req?.lifecycle ?? 'ACTIVE',
          relationship: m.relationship,
          evidenceExpectation: m.evidenceExpectation,
        };
      })
      .sort((a, b) => a.requirementId.localeCompare(b.requirementId));

    // If an evaluation exists, export evaluation details
    if (rawState?.latestEvaluationId) {
      const evaluation = evalById.get(rawState.latestEvaluationId);
      if (evaluation) {
        exportedEvaluations.push({
          evaluationId: evaluation.id,
          controlId: evaluation.controlId,
          evaluatorId: evaluation.evaluatorId,
          evaluatorVersion: evaluation.evaluatorVersion,
          status: evaluation.status,
          summary: evaluation.summary,
          evaluatedAt: evaluation.evaluatedAt.toISOString(),
          validUntil: evaluation.validUntil ? evaluation.validUntil.toISOString() : null,
          findings: (Array.isArray(evaluation.findings)
            ? evaluation.findings
            : []) as unknown as readonly ControlFinding[],
        });
      }
    }

    exportedControls.push({
      controlId: control.id,
      title: control.title,
      assessmentMode: control.assessmentMode,
      owner: control.owner,
      resolvedCurrentState,
      summary,
      evaluatedAt,
      validUntil,
      evaluator,
      evidenceCount: 0, // updated during evidence collection
      frameworkMappings: controlMappings,
      gaps: control.gaps,
      implementation: control.implementation,
      evidencePaths: control.evidence,
    });
  }

  // 4. Build framework definitions
  const exportedFrameworks: ExportedFrameworkDefinition[] = scope.frameworks.map(fw => ({
    id: fw.id,
    title: fw.title,
    version: fw.version,
    jurisdiction: fw.jurisdiction ?? null,
    frameworkType: fw.frameworkType,
    authoritativeSource: fw.authoritativeSource,
    sourceUrl: fw.sourceUrl,
    notes: fw.notes ?? null,
  }));

  // 5. Build framework requirements
  const exportedRequirements: ExportedFrameworkRequirement[] = scope.requirements.map(req => {
    const mapped = scope.mappings
      .filter(m => m.requirementId === req.id)
      .map(m => ({
        controlId: m.controlId,
        relationship: m.relationship,
      }))
      .sort((a, b) => a.controlId.localeCompare(b.controlId));

    return {
      requirementId: req.id,
      framework: req.framework,
      reference: req.reference,
      title: req.title,
      summary: req.summary,
      sourceUrl: req.sourceUrl,
      lifecycle: req.lifecycle,
      applicability: req.applicability,
      effectiveFrom: req.effectiveFrom ?? null,
      effectiveUntil: req.effectiveUntil ?? null,
      mappedControls: mapped,
      operatorAssessmentRequired: req.applicability !== 'PRODUCT',
    };
  });

  return {
    snapshotAt: snapshotAtIso,
    controls: exportedControls,
    evaluations: exportedEvaluations,
    frameworks: exportedFrameworks,
    requirements: exportedRequirements,
    controlEvidenceCounts: new Map(),
  };
}
