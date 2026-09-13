/** Reviewed repository metadata, never a certification or a deployment assessment. */
export type ComplianceFramework =
  | 'CRA'
  | 'GDPR'
  | 'SOC2'
  | 'ISO27001'
  | 'ISO27701'
  | 'DPDP'
  | 'CCPA';
export type ControlStatus = 'IMPLEMENTED' | 'PARTIAL' | 'MISSING';
export type ControlOwner = 'MAINTAINER' | 'OPERATOR' | 'ORGANIZATION';
export interface ComplianceControl {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly frameworks: readonly ComplianceFramework[];
  readonly status: ControlStatus;
  readonly owner: ControlOwner;
  readonly implementation: string;
  readonly evidence: readonly string[];
  readonly gaps: readonly string[];
}
