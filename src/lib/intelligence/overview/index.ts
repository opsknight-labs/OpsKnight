import 'server-only';
import { getIntelligenceSettings, resolveEffectivePolicy } from '../settings/service';

export * from './scope';
export * from './window';
export { getOverviewNoise, type OverviewNoise, type OverviewNoiseSource } from './noise';
export { getOverviewSpeed, type OverviewSpeed, type AcceptanceRate } from './speed';
export { getOverviewQuality, type OverviewQuality } from './quality';
export {
  getOverviewChange,
  type OverviewChange,
  type OverviewLinkedIncident,
  type OverviewRiskyChange,
} from './change';
export {
  getOverviewOutcomes,
  type OverviewOutcomes,
  type OutcomeBucket,
  type OutcomeTotals,
} from './outcomes';
export { getOverviewHealth, type OverviewHealth } from './health';

export interface OverviewStatus {
  /** The Intelligence master switch. */
  enabled: boolean;
  /** Global effective mode (OFF while the master switch is off). */
  mode: string;
  triageEnabled: boolean;
  responseEnabled: boolean;
}

/** Which features are on, so each section can explain itself when the feature behind it is off. */
export async function getOverviewStatus(): Promise<OverviewStatus> {
  const [settings, policy] = await Promise.all([
    getIntelligenceSettings(),
    resolveEffectivePolicy(null),
  ]);
  return {
    enabled: settings.enabled,
    mode: policy.effectiveMode,
    triageEnabled: policy.definition.triage.enabled,
    responseEnabled: policy.definition.response.enabled,
  };
}
