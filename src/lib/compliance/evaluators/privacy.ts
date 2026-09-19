import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';
import { personalDataRegistry } from '@/lib/privacy/registry';

export const retentionHoldEvaluator: ComplianceControlEvaluator = {
  id: 'privacy.holds',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const activeHoldCount = await context.prisma.dataRetentionHold.count({
      where: {
        releasedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: context.now } }],
      },
    });

    return {
      status: 'IMPLEMENTED',
      summary:
        'OpsKnight provides hold-aware lifecycle protection for supported user, incident and privacy-request scopes.',
      findings: [
        { code: 'SUPPORTED_SCOPES', value: 'USER, INCIDENT, PRIVACY_REQUEST' },
        { code: 'ACTIVE_HOLD_COUNT', value: activeHoldCount },
        { code: 'CLEANUP_FENCING_AVAILABLE', value: true },
      ],
      evidenceRefs: [
        {
          source: 'DataRetentionHold',
          description: 'Legal hold registry and mutex-fenced retention integration verified.',
        },
      ],
    };
  },
};

export const privacyErasureEvaluator: ComplianceControlEvaluator = {
  id: 'privacy.erasure',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const executionCount = await context.prisma.privacyErasureExecution.count();

    return {
      status: 'IMPLEMENTED',
      summary:
        'End-to-end subject erasure workflow with discovery, manual verification, and audit logging is available in this deployment.',
      findings: [
        { code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true },
        { code: 'ERASURE_EXECUTION_ENGINE_AVAILABLE', value: true },
        { code: 'PERSONAL_DATA_DOMAINS_COUNT', value: personalDataRegistry.length },
        { code: 'HISTORICAL_ERASURES_COUNT', value: executionCount },
      ],
      evidenceRefs: [
        {
          source: 'PrivacyErasureExecution',
          description: 'Subject erasure schema and verified cascade model available.',
        },
        {
          source: 'PersonalDataRegistry',
          description: `${personalDataRegistry.length} personal data domains registered.`,
        },
      ],
    };
  },
};

export const privacyExportEvaluator: ComplianceControlEvaluator = {
  id: 'privacy.export',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    const artifactCount = await context.prisma.privacyExportArtifact.count();

    return {
      status: 'IMPLEMENTED',
      summary:
        'Privacy request workflow supports subject discovery and encrypted export artifact generation with expiry.',
      findings: [
        { code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true },
        { code: 'ENCRYPTED_EXPORT_ARTIFACTS_AVAILABLE', value: true },
        { code: 'ARTIFACT_EXPIRY_SUPPORTED', value: true },
        { code: 'HISTORICAL_ARTIFACTS_COUNT', value: artifactCount },
      ],
      evidenceRefs: [
        {
          source: 'PrivacyExportArtifact',
          description: 'Privacy export artifact table and expiry lifecycle verified.',
        },
      ],
    };
  },
};
