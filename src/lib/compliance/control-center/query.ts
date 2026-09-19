import type { PrismaClient } from '@prisma/client';
import defaultPrisma from '@/lib/prisma';
import { complianceControls } from '../controls';
import { resolveComplianceRuntimeState } from '../state';
import {
  getMappingsForControl,
  getFrameworkRequirement,
  resolveRequirementLifecycle,
  ALL_FRAMEWORK_REQUIREMENTS,
  COMPLIANCE_FRAMEWORK_DEFINITIONS,
} from '../framework-mappings';
import { verifyComplianceEvidenceHash } from '../evidence/hash';
import type {
  AttentionRequiredItem,
  ComplianceControlCenterControl,
  ComplianceControlCenterOverview,
  ControlCenterEvidenceSummary,
  ControlCenterFrameworkMappingItem,
  ControlCenterRuntimeStateView,
} from './types';

export interface GetControlCenterDataOptions {
  readonly prisma?: PrismaClient;
  readonly now?: Date;
}

/**
 * Builds a unified, bulk-loaded Control Center read model.
 *
 * Guarantees:
 * 1. Bulk loading: Executes 2 parallel database queries without N+1 loops.
 * 2. Strict runtime resolution: Always delegates to resolveComplianceRuntimeState().
 * 3. Factual metrics: Strictly calculates inventory counts, zero compliance scores/percentages.
 * 4. PII-free: Contains zero personally identifiable information or raw secrets.
 */
export async function getComplianceControlCenterData(
  options?: GetControlCenterDataOptions
): Promise<ComplianceControlCenterOverview> {
  const prisma = options?.prisma ?? defaultPrisma;
  const now = options?.now ?? new Date();

  // 1. Bulk queries
  const [rawStates, evidenceRecords] = await Promise.all([
    prisma.complianceControlState.findMany(),
    prisma.complianceEvidence.findMany({
      orderBy: { observedAt: 'desc' },
    }),
  ]);

  const rawStateMap = new Map(rawStates.map(s => [s.controlId, s]));

  // 2. Group evidence by controlId and compute integrity
  type RawEvidence = (typeof evidenceRecords)[number];
  const evidenceByControl = new Map<string, RawEvidence[]>();
  for (const ev of evidenceRecords) {
    const list = evidenceByControl.get(ev.controlId) ?? [];
    list.push(ev);
    evidenceByControl.set(ev.controlId, list);
  }

  let totalMismatchesCount = 0;
  let totalVerifiedEvidenceCount = 0;

  const evidenceSummaryMap = new Map<string, ControlCenterEvidenceSummary>();
  for (const [controlId, list] of evidenceByControl.entries()) {
    let allValid = true;
    for (const ev of list) {
      const isValid = verifyComplianceEvidenceHash({
        evaluationId: ev.evaluationId,
        controlId: ev.controlId,
        type: ev.type,
        collectorId: ev.collectorId,
        collectorVersion: ev.collectorVersion,
        title: ev.title,
        description: ev.description,
        resourceType: ev.resourceType,
        resourceId: ev.resourceId,
        metadata: (ev.metadata ?? {}) as Record<string, unknown>,
        collectedAt: ev.collectedAt,
        observedAt: ev.observedAt,
        contentHash: ev.contentHash,
      });

      if (isValid) {
        totalVerifiedEvidenceCount++;
      } else {
        allValid = false;
        totalMismatchesCount++;
      }
    }

    evidenceSummaryMap.set(controlId, {
      count: list.length,
      latestObservedAt: list[0]?.observedAt.toISOString() ?? null,
      integrity: allValid && list.length > 0 ? 'VERIFIED' : list.length > 0 ? 'MISMATCH' : 'NONE',
      latestDigest: list[0]?.contentHash,
    });
  }

  // 3. Process each control
  const attentionItems: AttentionRequiredItem[] = [];
  const controls: ComplianceControlCenterControl[] = [];

  let runtimeTotal = 0;
  let runtimeImplemented = 0;
  let runtimePartial = 0;
  let runtimeActionRequired = 0;
  let runtimeUnverified = 0;

  for (const control of complianceControls) {
    const isRuntime = Boolean(control.evaluatorId);
    if (isRuntime) {
      runtimeTotal++;
    }

    const rawState = rawStateMap.get(control.id);
    const resolved = resolveComplianceRuntimeState(control, rawState, now);

    let runtimeView: ControlCenterRuntimeStateView | undefined;
    if (resolved) {
      runtimeView = {
        status: resolved.status,
        summary: resolved.summary,
        evaluatedAt: resolved.evaluatedAt.toISOString(),
        validUntil: resolved.validUntil ? resolved.validUntil.toISOString() : null,
        evaluatorId: resolved.evaluatorId,
        evaluatorVersion: resolved.evaluatorVersion,
        isVersionCurrent: resolved.isVersionCurrent,
      };

      if (isRuntime) {
        if (resolved.status === 'IMPLEMENTED') runtimeImplemented++;
        else if (resolved.status === 'PARTIAL') runtimePartial++;
        else if (resolved.status === 'ACTION_REQUIRED') runtimeActionRequired++;
        else runtimeUnverified++;
      }
    } else if (isRuntime) {
      runtimeUnverified++;
    }

    const evidenceSummary = evidenceSummaryMap.get(control.id) ?? {
      count: 0,
      latestObservedAt: null,
      integrity: 'NONE',
    };

    // Framework mappings
    const rawMappings = getMappingsForControl(control.id);
    const mappingItems: ControlCenterFrameworkMappingItem[] = [];
    for (const m of rawMappings) {
      const req = getFrameworkRequirement(m.requirementId);
      if (req) {
        const lifecycle = resolveRequirementLifecycle(req, now);
        mappingItems.push({
          framework: m.framework,
          requirementId: m.requirementId,
          reference: req.reference,
          title: req.title,
          lifecycle,
          relationship: m.relationship,
          evidenceExpectation: m.evidenceExpectation,
        });
      }
    }

    // Determine gaps
    const gaps: string[] = [];
    if (runtimeView) {
      if (runtimeView.status === 'ACTION_REQUIRED') {
        gaps.push(runtimeView.summary || 'Immediate operator remediation required.');
      } else if (runtimeView.status === 'UNVERIFIED') {
        gaps.push(runtimeView.summary || 'Control has not been authoritatively verified.');
      } else if (runtimeView.status === 'PARTIAL') {
        gaps.push(runtimeView.summary || 'Partial implementation observed.');
      }
    } else if (isRuntime) {
      gaps.push('No runtime evaluation recorded for this control.');
    } else if (control.status === 'PARTIAL' || control.status === 'MISSING') {
      gaps.push(control.description);
    }

    function getControlCategory(controlId: string): string {
      if (
        controlId.startsWith('SEC-AUTH-') ||
        controlId.startsWith('SEC-AUTHZ-') ||
        controlId.startsWith('SEC-SESSION-')
      ) {
        return 'Identity & Access';
      }
      if (controlId.startsWith('SEC-ENC-') || controlId.startsWith('SEC-KEY-')) {
        return 'Cryptography';
      }
      if (controlId.startsWith('SEC-AUDIT-')) {
        return 'Audit & Logging';
      }
      if (controlId.startsWith('PRIV-')) {
        return 'Privacy & Data Protection';
      }
      if (controlId.startsWith('OPS-') || controlId.startsWith('REL-')) {
        return 'Reliability & Operations';
      }
      return 'Security Baseline';
    }

    controls.push({
      controlId: control.id,
      title: control.title,
      description: control.description,
      category: getControlCategory(control.id),
      assessmentMode: isRuntime ? 'RUNTIME' : 'REPOSITORY',
      owner: control.owner,
      legacyStatus: control.status,
      runtime: runtimeView,
      evidence: evidenceSummary,
      frameworkMappings: mappingItems,
      gaps,
    });

    // Attention items
    if (runtimeView?.status === 'ACTION_REQUIRED') {
      attentionItems.push({
        id: `att-act-${control.id}`,
        controlId: control.id,
        controlTitle: control.title,
        severity: 'HIGH',
        type: 'ACTION_REQUIRED',
        reason: runtimeView.summary || 'Action required based on latest runtime evaluation.',
        evaluatedAt: runtimeView.evaluatedAt,
        actionLabel: 'Open Operations',
        actionType: 'VIEW_OPERATIONS',
      });
    } else if (isRuntime && (!runtimeView || runtimeView.status === 'UNVERIFIED')) {
      attentionItems.push({
        id: `att-unv-${control.id}`,
        controlId: control.id,
        controlTitle: control.title,
        severity: 'MEDIUM',
        type: 'UNVERIFIED',
        reason: runtimeView?.summary || 'Control has no valid runtime evaluation recorded.',
        evaluatedAt: runtimeView?.evaluatedAt,
        actionLabel: 'Evaluate Control',
        actionType: 'EVALUATE',
      });
    }

    if (evidenceSummary.integrity === 'MISMATCH') {
      attentionItems.push({
        id: `att-mis-${control.id}`,
        controlId: control.id,
        controlTitle: control.title,
        severity: 'HIGH',
        type: 'INTEGRITY_MISMATCH',
        reason: 'One or more evidence snapshots failed SHA-256 integrity hash verification.',
        actionLabel: 'Inspect Evidence',
        actionType: 'VIEW_EVIDENCE',
      });
    }
  }

  // Framework requirement lifecycles summary
  let activeRequirements = 0;
  let futureRequirements = 0;
  let supersededRequirements = 0;

  for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
    const lifecycle = resolveRequirementLifecycle(req, now);
    if (lifecycle === 'ACTIVE') activeRequirements++;
    else if (lifecycle === 'FUTURE') futureRequirements++;
    else if (lifecycle === 'SUPERSEDED') supersededRequirements++;
  }

  return {
    generatedAt: now.toISOString(),
    runtime: {
      total: runtimeTotal,
      implemented: runtimeImplemented,
      partial: runtimePartial,
      actionRequired: runtimeActionRequired,
      unverified: runtimeUnverified,
    },
    evidence: {
      records: evidenceRecords.length,
      verifiedRecords: totalVerifiedEvidenceCount,
      integrityMismatches: totalMismatchesCount,
    },
    frameworks: {
      count: COMPLIANCE_FRAMEWORK_DEFINITIONS.length,
      activeRequirements,
      futureRequirements,
      supersededRequirements,
    },
    attention: attentionItems,
    controls,
  };
}
