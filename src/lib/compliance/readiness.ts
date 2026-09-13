import { complianceControls } from './controls';
import type { ComplianceControl, ComplianceFramework, ControlStatus } from './types';

/** Counts describe this curated catalogue only. No percentage or certification score. */
export function getReadiness(
  framework?: ComplianceFramework,
  controls: readonly ComplianceControl[] = complianceControls
) {
  const counts: Record<ControlStatus, number> = { IMPLEMENTED: 0, PARTIAL: 0, MISSING: 0 };
  for (const control of controls) {
    if (!framework || control.frameworks.includes(framework)) counts[control.status] += 1;
  }
  return counts;
}
