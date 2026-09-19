import crypto from 'node:crypto';
import { complianceControls } from './controls';
import type { ComplianceControlDefinition } from './types';
import { complianceEvaluatorRegistry } from './evaluators';

export { complianceControls };

export function getComplianceControl(id: string): ComplianceControlDefinition | undefined {
  return complianceControls.find(c => c.id === id);
}

export function getRuntimeComplianceControls(): readonly ComplianceControlDefinition[] {
  return complianceControls.filter(c => c.assessmentMode === 'RUNTIME');
}

export function computeComplianceControlRegistryFingerprint(): string {
  const canonical = complianceControls
    .map(c => {
      const evaluator = c.evaluatorId ? complianceEvaluatorRegistry[c.evaluatorId] : undefined;
      return {
        id: c.id,
        assessmentMode: c.assessmentMode,
        evaluatorId: c.evaluatorId ?? null,
        evaluatorVersion: evaluator?.version ?? null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
