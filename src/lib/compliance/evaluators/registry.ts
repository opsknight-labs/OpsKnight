import type { ComplianceControlEvaluator } from './types';
import { encryptionAtRestEvaluator } from './encryption';
import { retentionEvaluator } from './retention';
import { privacyErasureEvaluator, privacyExportEvaluator, retentionHoldEvaluator } from './privacy';
import { authorizationEvaluator } from './authorization';

const registryMap = new Map<string, ComplianceControlEvaluator>([
  ['encryption.at-rest', encryptionAtRestEvaluator],
  ['data.retention', retentionEvaluator],
  ['privacy.erasure', privacyErasureEvaluator],
  ['privacy.export', privacyExportEvaluator],
  ['privacy.holds', retentionHoldEvaluator],
  ['authorization.rbac', authorizationEvaluator],
]);

export const complianceEvaluatorRegistry: Record<string, ComplianceControlEvaluator> = new Proxy(
  {} as Record<string, ComplianceControlEvaluator>,
  {
    get(_target, prop: string) {
      return registryMap.get(prop);
    },
    set(_target, prop: string, value: ComplianceControlEvaluator) {
      registryMap.set(prop, value);
      return true;
    },
    has(_target, prop: string) {
      return registryMap.has(prop);
    },
    ownKeys() {
      return Array.from(registryMap.keys());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (registryMap.has(prop)) {
        return {
          value: registryMap.get(prop),
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  }
);

export function getComplianceEvaluator(
  evaluatorId: string
): ComplianceControlEvaluator | undefined {
  return registryMap.get(evaluatorId);
}
