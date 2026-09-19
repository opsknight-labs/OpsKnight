import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';
import { computeRegistryFingerprint } from '@/lib/encryption/registry';
import { getActiveKeyId } from '@/lib/encryption';

export const encryptionAtRestEvaluator: ComplianceControlEvaluator = {
  id: 'encryption.at-rest',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const currentFingerprint = computeRegistryFingerprint();
    const activeKeyId = getActiveKeyId();

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
        evidenceRefs: [
          {
            source: 'EncryptionMigrationRun',
            referenceId: latestVerifyRun.id,
            description: 'Run registryFingerprint does not match current schema fingerprint.',
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

    const blockingIssues =
      unavailableKeyCount +
      ambiguousCount +
      unreadableCount +
      latestVerifyRun.errorRecords +
      latestVerifyRun.conflictRecords;

    const legacyRecords = oldKeyCount + legacyV2Count + legacyV1Count + plaintextCount;

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
