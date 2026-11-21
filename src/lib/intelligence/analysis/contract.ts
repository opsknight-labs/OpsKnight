import { sha256 } from '../ai/digest';
import type { EffectivePolicy } from '../settings/service';

export const analysisPolicyHash = (policy: EffectivePolicy): string =>
  sha256(
    JSON.stringify({
      id: policy.policyId,
      version: policy.version,
      source: policy.source,
      mode: policy.effectiveMode,
      definition: policy.definition,
    })
  );
export type AnalysisStatus =
  'WAITING' | 'CURRENT' | 'STALE' | 'PAUSED' | 'FAILED' | 'OFF' | 'SHADOW' | 'UNAVAILABLE';
export interface IncidentAnalysisState {
  status: AnalysisStatus;
  message: string;
  lastSuccessfulAt?: string;
  retryAt?: string;
  canRefresh: boolean;
  diagnosticsHref?: string;
}
