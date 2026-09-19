import type { ComplianceControlEvaluator } from './types';
import { encryptionAtRestEvaluator } from './encryption';
import { retentionEvaluator } from './retention';
import { privacyErasureEvaluator, privacyExportEvaluator, retentionHoldEvaluator } from './privacy';
import { authorizationEvaluator } from './authorization';

export const complianceEvaluatorRegistry: Record<string, ComplianceControlEvaluator> = {
  'encryption.at-rest': encryptionAtRestEvaluator,
  'data.retention': retentionEvaluator,
  'privacy.erasure': privacyErasureEvaluator,
  'privacy.export': privacyExportEvaluator,
  'privacy.holds': retentionHoldEvaluator,
  'authorization.rbac': authorizationEvaluator,
};

export function getComplianceEvaluator(
  evaluatorId: string
): ComplianceControlEvaluator | undefined {
  if (!Object.prototype.hasOwnProperty.call(complianceEvaluatorRegistry, evaluatorId)) {
    return undefined;
  }
  return complianceEvaluatorRegistry[evaluatorId];
}
