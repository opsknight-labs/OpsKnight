import type {
  PrismaClient,
  ComplianceEvaluationStatus,
  ComplianceControlState,
} from '@prisma/client';
import prismaClient from '../../prisma';
import type { ControlFinding } from '../types';
import { resolveComplianceRuntimeState } from '../state';
import { getComplianceEvaluator } from '../evaluators';
import { resolveRequirementLifecycle } from '../framework-mappings/lifecycle';
import type { FrameworkControlMapping } from '../framework-mappings/types';
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
  readonly mappings: readonly FrameworkControlMapping[];
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

  // 2. Identify controls where the stored state was evaluated/committed after snapshotAt or is missing
  const controlsNeedingHistoricalEval: string[] = [];
  const validCurrentEvalIds: string[] = [];

  for (const controlId of controlIds) {
    const s = stateByControl.get(controlId);
    const isCommittedBeforeCutoff = Boolean(
      s && s.evaluatedAt <= snapshotAt && (!s.updatedAt || s.updatedAt <= snapshotAt)
    );

    if (!isCommittedBeforeCutoff) {
      controlsNeedingHistoricalEval.push(controlId);
    } else if (s?.latestEvaluationId) {
      validCurrentEvalIds.push(s.latestEvaluationId);
    }
  }

  // 3. For controls evaluated after snapshotAt (or missing state), query the latest evaluation committed at or before snapshotAt
  type HistoricalEvalRecord = {
    id: string;
    controlId: string;
    evaluatorId: string;
    evaluatorVersion: string;
    status: ComplianceEvaluationStatus;
    evaluatedAt: Date;
    validUntil: Date | null;
    summary: string | null;
    findings: unknown;
  };

  const historicalEvalByControl = new Map<string, HistoricalEvalRecord>();
  if (controlsNeedingHistoricalEval.length > 0) {
    for (const cid of controlsNeedingHistoricalEval) {
      const histEval = await prisma.complianceEvaluation.findFirst({
        where: {
          controlId: cid,
          evaluatedAt: { lte: snapshotAt },
          createdAt: { lte: snapshotAt },
        },
        orderBy: { evaluatedAt: 'desc' },
      });
      if (histEval) {
        historicalEvalByControl.set(cid, histEval);
      }
    }
  }

  // 4. Fetch the evaluations needed for valid current states (verifying createdAt <= snapshotAt)
  const evaluations =
    validCurrentEvalIds.length > 0
      ? await prisma.complianceEvaluation.findMany({
          where: {
            id: { in: validCurrentEvalIds },
            createdAt: { lte: snapshotAt },
          },
        })
      : [];
  const evalById = new Map<string, HistoricalEvalRecord>(evaluations.map(e => [e.id, e]));

  // Add historical evaluations to evalById
  for (const histEval of historicalEvalByControl.values()) {
    evalById.set(histEval.id, histEval);
  }

  // 5. Build authoritative control snapshots
  const exportedControls: ExportedControlSnapshot[] = [];
  const exportedEvaluations: ExportedEvaluationSnapshot[] = [];

  for (const control of scope.controls) {
    let rawState: ComplianceControlState | null = null;

    const currentState = stateByControl.get(control.id);
    const isCurrentStateCommitted = Boolean(
      currentState &&
      currentState.evaluatedAt <= snapshotAt &&
      (!currentState.updatedAt || currentState.updatedAt <= snapshotAt)
    );

    if (isCurrentStateCommitted && currentState) {
      rawState = currentState;
    } else {
      const histEval = historicalEvalByControl.get(control.id);
      if (histEval) {
        rawState = {
          controlId: control.id,
          status: histEval.status,
          latestEvaluationId: histEval.id,
          evaluatorId: histEval.evaluatorId,
          evaluatorVersion: histEval.evaluatorVersion,
          evaluatedAt: histEval.evaluatedAt,
          validUntil: histEval.validUntil,
          summary: histEval.summary ?? '',
          updatedAt: histEval.evaluatedAt,
        };
      }
    }

    const runtimeState = resolveComplianceRuntimeState(control, rawState, snapshotAt);

    let resolvedCurrentState: ExportedControlSnapshot['resolvedCurrentState'];
    let evaluatedAt: string | null = null;
    let validUntil: string | null = null;
    let summary: string | null = null;

    if (control.assessmentMode === 'RUNTIME') {
      if (!runtimeState) {
        resolvedCurrentState = 'UNVERIFIED';
        summary = 'Runtime control not yet evaluated; evaluation required.';
      } else {
        resolvedCurrentState = runtimeState.status;
        evaluatedAt = runtimeState.evaluatedAt ? runtimeState.evaluatedAt.toISOString() : null;
        validUntil = runtimeState.validUntil ? runtimeState.validUntil.toISOString() : null;
        summary = runtimeState.summary;
      }
    } else {
      // Non-runtime (catalog / repository) - normalize status exactly like PR4
      const catalogStatus = control.catalogStatus ?? control.status;
      resolvedCurrentState =
        catalogStatus === 'IMPLEMENTED'
          ? 'IMPLEMENTED'
          : catalogStatus === 'PARTIAL'
            ? 'PARTIAL'
            : 'ACTION_REQUIRED';
      summary = control.description;
    }

    const evaluator = control.evaluatorId
      ? {
          id: control.evaluatorId,
          version: getComplianceEvaluator(control.evaluatorId)?.version ?? 'unknown',
        }
      : null;

    // Associated framework mappings for this control with snapshot-resolved lifecycle
    const controlMappings = scope.mappings
      .filter(m => m.controlId === control.id)
      .map(m => {
        const req = scope.requirements.find(r => r.id === m.requirementId);
        return {
          framework: m.framework,
          requirementId: m.requirementId,
          reference: req?.reference ?? m.requirementId,
          lifecycle: req ? resolveRequirementLifecycle(req, snapshotAt) : 'ACTIVE',
          relationship: m.relationship,
          evidenceExpectation: m.evidenceExpectation,
          rationale: m.rationale,
          notes: m.notes,
        };
      })
      .sort((a, b) => a.requirementId.localeCompare(b.requirementId));

    // If an evaluation exists at or before snapshotAt, export evaluation details
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

  // 6. Build framework definitions
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

  // 7. Build framework requirements with snapshot-resolved lifecycle
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
      lifecycle: resolveRequirementLifecycle(req, snapshotAt),
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
    mappings: scope.mappings,
    controlEvidenceCounts: new Map(),
  };
}
