import type { BusinessServiceEngine } from './contract';

// shortcut: every method throws until P1b lands the real engine; tests use __fixtures__/health.ts.
const notYet = (name: string) => () =>
  Promise.reject(new Error(`business-services ${name} is not implemented yet (P1b)`));

export const engine: BusinessServiceEngine = {
  getBusinessServiceHealth: notYet('getBusinessServiceHealth'),
  listBusinessServices: notYet('listBusinessServices'),
  getImpactTimeline: notYet('getImpactTimeline'),
  getBusinessServiceStats: notYet('getBusinessServiceStats'),
  setIncidentImpact: notYet('setIncidentImpact'),
  wouldCreateSupportCycle: notYet('wouldCreateSupportCycle'),
};
