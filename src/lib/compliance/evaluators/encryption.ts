import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';
import { computeRegistryFingerprint, ENCRYPTION_TARGETS } from '@/lib/encryption/registry';
import { getActiveKeyId } from '@/lib/encryption';
import { createEvidenceDraft } from '../evidence/build';

export const encryptionAtRestEvaluator: ComplianceControlEvaluator = {
  id: 'encryption.at-rest',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const currentFingerprint = computeRegistryFingerprint();
    const activeKeyId = getActiveKeyId();

    if (!activeKeyId) {
      return {
        status: 'ACTION_REQUIRED',
        summary: 'No active encryption key is configured.',
        findings: [
          {
            code: 'NO_ACTIVE_KEY',
            message: 'No active encryption key is configured in the environment keyring.',
            severity: 'ERROR',
          },
        ],
        evidence: [
          createEvidenceDraft({
            type: 'EVALUATION_FAILURE',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1',
            title: 'Active Encryption Key Check',
            description: 'No active encryption key is configured in the environment keyring.',
            observedAt: context.now,
            metadata: {
              activeKeyConfigured: false,
              errorCode: 'NO_ACTIVE_KEY',
            },
          }),
        ],
        evidenceRefs: [
          {
            source: 'Keyring',
            description: 'Active key missing from configuration.',
          },
        ],
      };
    }

    const latestVerifyRun = await context.prisma.encryptionMigrationRun.findFirst({
      where: {
        mode: 'VERIFY',
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
      include: {
        targetStates: true,
      },
    });

    if (!latestVerifyRun) {
      return {
        status: 'UNVERIFIED',
        summary: 'No completed encryption verification exists in this deployment.',
        findings: [
          {
            code: 'VERIFICATION_MISSING',
            message: 'Run an encryption verification to evaluate runtime control posture.',
            severity: 'WARNING',
          },
        ],
        evidence: [
          createEvidenceDraft({
            type: 'VERIFICATION_RESULT',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1',
            title: 'Encryption Verification Run Missing',
            description: 'No completed verification run found in database.',
            observedAt: context.now,
            metadata: {
              completedVerifyRunFound: false,
              activeKeyId,
            },
          }),
        ],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            description: 'No completed VERIFY run found in database.',
          },
        ],
      };
    }

    if (latestVerifyRun.registryFingerprint !== currentFingerprint) {
      return {
        status: 'UNVERIFIED',
        summary:
          'Latest encryption verification was performed against an outdated target registry fingerprint.',
        findings: [
          {
            code: 'FINGERPRINT_MISMATCH',
            message: 'Target secret definitions have changed since the last verification run.',
            severity: 'WARNING',
          },
        ],
        evidence: [
          createEvidenceDraft({
            type: 'VERIFICATION_RESULT',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1',
            title: 'Encryption Verification Registry Fingerprint Mismatch',
            description: 'Run registry fingerprint does not match current schema fingerprint.',
            resourceType: 'EncryptionMigrationRun',
            resourceId: latestVerifyRun.id,
            observedAt: latestVerifyRun.completedAt ?? context.now,
            metadata: {
              runId: latestVerifyRun.id,
              runFingerprint: latestVerifyRun.registryFingerprint,
              currentFingerprint,
              fingerprintMatches: false,
            },
          }),
        ],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: 'Run registryFingerprint does not match current schema fingerprint.',
          },
        ],
      };
    }

    if (latestVerifyRun.activeKeyId !== activeKeyId) {
      return {
        status: 'UNVERIFIED',
        summary:
          'The active encryption key changed since the latest verification. Run verification again.',
        findings: [
          {
            code: 'ACTIVE_KEY_CHANGED_SINCE_VERIFICATION',
            message: `Active key changed from "${latestVerifyRun.activeKeyId ?? 'none'}" during verification to "${activeKeyId}".`,
            severity: 'WARNING',
          },
        ],
        evidence: [
          createEvidenceDraft({
            type: 'VERIFICATION_RESULT',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1',
            title: 'Encryption Verification Active Key Mismatch',
            description: 'Active encryption key changed since the latest verification run.',
            resourceType: 'EncryptionMigrationRun',
            resourceId: latestVerifyRun.id,
            observedAt: latestVerifyRun.completedAt ?? context.now,
            metadata: {
              runId: latestVerifyRun.id,
              verificationActiveKeyId: latestVerifyRun.activeKeyId,
              currentActiveKeyId: activeKeyId,
              keyMatches: false,
            },
          }),
        ],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: `Verification performed with active key "${latestVerifyRun.activeKeyId ?? 'none'}", but runtime active key is "${activeKeyId}".`,
          },
        ],
      };
    }

    const targetMap = new Map(latestVerifyRun.targetStates.map(t => [t.targetId, t]));
    const missingTargetIds: string[] = [];
    const incompleteTargetIds: string[] = [];

    for (const expectedTarget of ENCRYPTION_TARGETS) {
      const state = targetMap.get(expectedTarget.id);
      if (!state) {
        missingTargetIds.push(expectedTarget.id);
      } else if (state.status !== 'COMPLETED' || state.processedCount !== state.totalCount) {
        incompleteTargetIds.push(expectedTarget.id);
      }
    }

    if (missingTargetIds.length > 0 || incompleteTargetIds.length > 0) {
      return {
        status: 'UNVERIFIED',
        summary:
          'Latest encryption verification does not cover all registered encryption targets completely.',
        findings: [
          {
            code: 'INCOMPLETE_VERIFICATION_COVERAGE',
            message: `Verification missing or incomplete for targets: ${[...missingTargetIds, ...incompleteTargetIds].join(', ')}`,
            severity: 'WARNING',
          },
          ...(missingTargetIds.length > 0
            ? [{ code: 'MISSING_TARGET_COUNT', value: missingTargetIds.length }]
            : []),
          ...(incompleteTargetIds.length > 0
            ? [{ code: 'INCOMPLETE_TARGET_COUNT', value: incompleteTargetIds.length }]
            : []),
        ],
        evidence: [
          createEvidenceDraft({
            type: 'VERIFICATION_RESULT',
            collectorId: 'encryption.at-rest',
            collectorVersion: '1',
            title: 'Encryption Target Verification Incomplete',
            description:
              'Verification does not cover all registered encryption targets completely.',
            resourceType: 'EncryptionMigrationRun',
            resourceId: latestVerifyRun.id,
            observedAt: latestVerifyRun.completedAt ?? context.now,
            metadata: {
              runId: latestVerifyRun.id,
              expectedTargets: ENCRYPTION_TARGETS.length,
              verifiedTargets: latestVerifyRun.targetStates.length,
              missingTargetCount: missingTargetIds.length,
              incompleteTargetCount: incompleteTargetIds.length,
            },
          }),
        ],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: `Only ${latestVerifyRun.targetStates.length}/${ENCRYPTION_TARGETS.length} targets verified.`,
          },
        ],
      };
    }

    let unavailableKeyCount = 0;
    let ambiguousCount = 0;
    let unreadableCount = 0;
    let oldKeyCount = 0;
    let legacyV2Count = 0;
    let legacyV1Count = 0;
    let plaintextCount = 0;
    let currentV3Count = 0;

    for (const target of latestVerifyRun.targetStates) {
      const stats = (target.inspectionStats as Record<string, number> | null) ?? {};
      unavailableKeyCount += stats.unavailableKey ?? 0;
      ambiguousCount += stats.ambiguous ?? 0;
      unreadableCount += stats.unreadable ?? 0;
      oldKeyCount += stats.oldKeyV3 ?? 0;
      legacyV2Count += stats.legacyV2 ?? 0;
      legacyV1Count += stats.legacyV1 ?? 0;
      plaintextCount += stats.plaintext ?? 0;
      currentV3Count += stats.currentV3 ?? 0;
    }

    const inspectionErrors = unavailableKeyCount + ambiguousCount + unreadableCount;
    const blockingIssues =
      Math.max(inspectionErrors, latestVerifyRun.errorRecords) + latestVerifyRun.conflictRecords;

    const legacyRecords = oldKeyCount + legacyV2Count + legacyV1Count + plaintextCount;

    const evidenceDraft = createEvidenceDraft({
      type: 'VERIFICATION_RESULT',
      collectorId: 'encryption.at-rest',
      collectorVersion: '1',
      title: 'Encryption Verification Summary',
      description: 'Stored-secret verification results across all registered targets.',
      resourceType: 'EncryptionMigrationRun',
      resourceId: latestVerifyRun.id,
      observedAt: latestVerifyRun.completedAt ?? context.now,
      metadata: {
        runId: latestVerifyRun.id,
        registryFingerprint: latestVerifyRun.registryFingerprint,
        verificationActiveKeyId: latestVerifyRun.activeKeyId,
        currentActiveKeyId: activeKeyId,
        expectedTargets: ENCRYPTION_TARGETS.length,
        verifiedTargets: latestVerifyRun.targetStates.length,
        currentV3: currentV3Count,
        oldKeyV3: oldKeyCount,
        legacyV2: legacyV2Count,
        legacyV1: legacyV1Count,
        plaintext: plaintextCount,
        unavailableKey: unavailableKeyCount,
        ambiguous: ambiguousCount,
        unreadable: unreadableCount,
        conflicts: latestVerifyRun.conflictRecords,
        blockingIssues,
        legacyRecords,
      },
    });

    if (blockingIssues > 0) {
      return {
        status: 'ACTION_REQUIRED',
        summary: `Stored-secret encryption verification identified ${blockingIssues} blocking issue(s).`,
        findings: [
          { code: 'ACTIVE_KEY', value: activeKeyId },
          { code: 'BLOCKING_ISSUES', value: blockingIssues, severity: 'ERROR' },
          {
            code: 'UNREADABLE_RECORDS',
            value: unreadableCount,
            severity: unreadableCount > 0 ? 'ERROR' : 'INFO',
          },
          {
            code: 'UNAVAILABLE_KEY_RECORDS',
            value: unavailableKeyCount,
            severity: unavailableKeyCount > 0 ? 'ERROR' : 'INFO',
          },
          {
            code: 'AMBIGUOUS_RECORDS',
            value: ambiguousCount,
            severity: ambiguousCount > 0 ? 'ERROR' : 'INFO',
          },
          {
            code: 'CONFLICT_RECORDS',
            value: latestVerifyRun.conflictRecords,
            severity: latestVerifyRun.conflictRecords > 0 ? 'ERROR' : 'INFO',
          },
        ],
        evidence: [evidenceDraft],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: `Verification run completed with ${blockingIssues} unresolved issue(s).`,
          },
        ],
      };
    }

    if (legacyRecords > 0) {
      return {
        status: 'PARTIAL',
        summary: `Stored-secret encryption is operational, but ${legacyRecords} record(s) remain on older keys or legacy formats.`,
        findings: [
          { code: 'ACTIVE_KEY', value: activeKeyId },
          { code: 'LEGACY_RECORDS', value: legacyRecords, severity: 'WARNING' },
          { code: 'OLD_KEY_V3_RECORDS', value: oldKeyCount },
          { code: 'LEGACY_V2_RECORDS', value: legacyV2Count },
          { code: 'LEGACY_V1_RECORDS', value: legacyV1Count },
          { code: 'PLAINTEXT_RECORDS', value: plaintextCount },
        ],
        evidence: [evidenceDraft],
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: `Verification run confirmed ${legacyRecords} candidate record(s) awaiting migration.`,
          },
        ],
      };
    }

    return {
      status: 'IMPLEMENTED',
      summary:
        'Stored-secret encryption verification completed successfully with all records authenticated on the active key.',
      findings: [
        { code: 'ACTIVE_KEY', value: activeKeyId },
        { code: 'AUTHENTICATED_CURRENT_V3', value: currentV3Count },
        { code: 'LEGACY_RECORDS', value: 0 },
        { code: 'UNREADABLE_RECORDS', value: 0 },
        { code: 'BLOCKING_ISSUES', value: 0 },
      ],
      evidence: [evidenceDraft],
      evidenceRefs: [
        {
          source: 'EncryptionMigrationRun',
          referenceId: latestVerifyRun.id,
          description: `Verification run ${latestVerifyRun.id} authenticated ${currentV3Count} record(s) on key ${activeKeyId}.`,
        },
      ],
    };
  },
};
