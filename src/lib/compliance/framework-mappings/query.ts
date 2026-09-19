import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import type { ComplianceFramework } from '../types';
import { complianceControls } from '../controls';
import type {
  FrameworkSummaryView,
  FrameworkRequirementView,
  FrameworkControlMapping,
} from './types';
import {
  getFramework,
  getFrameworkRequirements,
  getFrameworkRequirement,
  getMappingsForRequirement,
  getMappingsForControl,
} from './registry';
import { resolveRequirementLifecycle } from './lifecycle';
import { verifyComplianceEvidenceHash } from '../evidence/hash';

export interface QueryOptions {
  prisma?: PrismaClient;
  now?: Date;
}

/**
 * Computes a factual summary of a framework without scoring or compliance percentages.
 */
export function getFrameworkSummaryView(
  frameworkId: ComplianceFramework,
  now: Date = new Date()
): FrameworkSummaryView | undefined {
  const framework = getFramework(frameworkId);
  if (!framework) return undefined;

  const requirements = getFrameworkRequirements(frameworkId);
  const mappedControlIds = new Set<string>();

  let runtimeBackedCount = 0;
  let repositoryBackedCount = 0;
  let operatorDependencyCount = 0;
  let organizationalDependencyCount = 0;
  let futureRequirementsCount = 0;

  for (const req of requirements) {
    const lifecycle = resolveRequirementLifecycle(req, now);
    if (lifecycle === 'FUTURE') {
      futureRequirementsCount++;
    }

    const mappings = getMappingsForRequirement(req.id);
    for (const mapping of mappings) {
      mappedControlIds.add(mapping.controlId);

      if (mapping.evidenceExpectation === 'RUNTIME') {
        runtimeBackedCount++;
      } else if (mapping.evidenceExpectation === 'REPOSITORY') {
        repositoryBackedCount++;
      }

      if (
        mapping.relationship === 'OPERATOR_DEPENDENCY' ||
        mapping.evidenceExpectation === 'OPERATOR'
      ) {
        operatorDependencyCount++;
      }

      if (
        mapping.relationship === 'ORGANIZATIONAL_DEPENDENCY' ||
        mapping.evidenceExpectation === 'ORGANIZATIONAL'
      ) {
        organizationalDependencyCount++;
      }
    }
  }

  return {
    framework,
    mappedRequirementsCount: requirements.length,
    mappedControlsCount: mappedControlIds.size,
    runtimeBackedCount,
    repositoryBackedCount,
    operatorDependencyCount,
    organizationalDependencyCount,
    futureRequirementsCount,
  };
}

/**
 * Builds a detailed view of a single framework requirement joining control definitions,
 * runtime control states, and evidence summaries without exposing raw secrets.
 */
export async function getFrameworkRequirementDetailView(
  requirementId: string,
  options?: QueryOptions
): Promise<FrameworkRequirementView | undefined> {
  const req = getFrameworkRequirement(requirementId);
  if (!req) return undefined;

  const now = options?.now ?? new Date();
  const resolvedLifecycle = resolveRequirementLifecycle(req, now);
  const mappings = getMappingsForRequirement(requirementId);
  const controlMap = new Map(complianceControls.map(c => [c.id, c]));

  const prisma = options?.prisma ?? defaultPrisma;

  const controlDetails: FrameworkRequirementView['mappings'][number][] = [];

  for (const mapping of mappings) {
    const control = controlMap.get(mapping.controlId);
    if (!control) continue;

    let runtimeState: FrameworkRequirementView['mappings'][number]['runtimeState'] | undefined;
    let evidenceSummary:
      | FrameworkRequirementView['mappings'][number]['evidenceSummary']
      | undefined;

    if (control.evaluatorId && prisma) {
      try {
        const stateRecord = await prisma.complianceControlState.findUnique({
          where: { controlId: control.id },
        });

        if (stateRecord) {
          runtimeState = {
            status: stateRecord.status,
            summary: stateRecord.summary,
            lastEvaluatedAt: stateRecord.lastEvaluatedAt.toISOString(),
            activeKeyId: stateRecord.activeKeyId,
            validUntil: stateRecord.validUntil ? stateRecord.validUntil.toISOString() : null,
          };

          if (stateRecord.latestEvaluationId) {
            const evidenceRecords = await prisma.complianceEvidence.findMany({
              where: { evaluationId: stateRecord.latestEvaluationId },
              orderBy: { observedAt: 'desc' },
            });

            if (evidenceRecords.length > 0) {
              const latestEvidence = evidenceRecords[0];
              const integrityValid = evidenceRecords.every(ev =>
                verifyComplianceEvidenceHash({
                  id: ev.id,
                  evaluationId: ev.evaluationId,
                  controlId: ev.controlId,
                  type: ev.type,
                  collectorId: ev.collectorId,
                  collectorVersion: ev.collectorVersion,
                  title: ev.title,
                  description: ev.description,
                  resourceType: ev.resourceType,
                  resourceId: ev.resourceId,
                  metadata: ev.metadata,
                  collectedAt: ev.collectedAt,
                  observedAt: ev.observedAt,
                  validUntil: ev.validUntil,
                  contentHash: ev.contentHash,
                })
              );

              evidenceSummary = {
                latestObservedAt: latestEvidence.observedAt.toISOString(),
                recordCount: evidenceRecords.length,
                integrityValid,
                latestDigest: latestEvidence.contentHash,
              };
            }
          }
        }
      } catch {
        // Fall back gracefully if database is unavailable or control has not been evaluated
      }
    }

    controlDetails.push({
      mappingId: mapping.id,
      controlId: control.id,
      controlTitle: control.title,
      relationship: mapping.relationship,
      evidenceExpectation: mapping.evidenceExpectation,
      rationale: mapping.rationale,
      owner: control.owner,
      assessmentMode: control.assessmentMode,
      runtimeState,
      evidenceSummary,
    });
  }

  return {
    requirement: req,
    resolvedLifecycle,
    mappings: controlDetails,
  };
}

/**
 * Returns all requirement detail views for a framework.
 */
export async function getFrameworkRequirementsWithViews(
  frameworkId: ComplianceFramework,
  options?: QueryOptions
): Promise<readonly FrameworkRequirementView[]> {
  const requirements = getFrameworkRequirements(frameworkId);
  const views: FrameworkRequirementView[] = [];

  for (const req of requirements) {
    const view = await getFrameworkRequirementDetailView(req.id, options);
    if (view) {
      views.push(view);
    }
  }

  return views;
}

/**
 * Returns all framework mappings for a specific control.
 */
export function getControlFrameworkMappingsView(
  controlId: string
): readonly (FrameworkControlMapping & {
  readonly requirementTitle: string;
  readonly reference: string;
})[] {
  const mappings = getMappingsForControl(controlId);
  return mappings.map(m => {
    const req = getFrameworkRequirement(m.requirementId);
    return {
      ...m,
      requirementTitle: req ? req.title : m.requirementId,
      reference: req ? req.reference : m.requirementId,
    };
  });
}
