import { describe, expect, it } from 'vitest';
import {
  getMetricDefinition,
  INCIDENT_METRIC_DEFINITIONS,
  metricDefinitionTooltip,
  metricScopeLabel,
} from '@/lib/metric-contract';

describe('incident metric contract', () => {
  it('keeps current backlog separate from selected-period cohorts', () => {
    expect(INCIDENT_METRIC_DEFINITIONS.activeIncidents.scope).toBe('current');
    expect(INCIDENT_METRIC_DEFINITIONS.mutedIncidents.scope).toBe('current');
    expect(INCIDENT_METRIC_DEFINITIONS.totalIncidents.scope).toBe('selected_period');
    expect(INCIDENT_METRIC_DEFINITIONS.resolvedIncidents.scope).toBe('selected_period');
  });

  it('maps server fields to definitions with stable meanings', () => {
    expect(getMetricDefinition('openCount')).toBe(INCIDENT_METRIC_DEFINITIONS.triggeredIncidents);
    expect(getMetricDefinition('criticalCount')).toBe(
      INCIDENT_METRIC_DEFINITIONS.highUrgencyActive
    );
    expect(getMetricDefinition('highUrgencyCount')).toBe(
      INCIDENT_METRIC_DEFINITIONS.highUrgencyPeriod
    );
  });

  it('exposes scope and formula in metric help text', () => {
    expect(metricScopeLabel('rolling_24h')).toBe('Last 24h');
    expect(metricScopeLabel('selected_period', 'Last 30 days')).toBe('Last 30 days');
    expect(metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)).toContain(
      'Triggered (OPEN) + Acknowledged'
    );
    expect(metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)).toContain(
      'Scope: Current'
    );
  });

  it('declares whether a movement is favorable before coloring trends', () => {
    expect(INCIDENT_METRIC_DEFINITIONS.totalIncidents.direction).toBe('lower_is_better');
    expect(INCIDENT_METRIC_DEFINITIONS.mttr.direction).toBe('lower_is_better');
    expect(INCIDENT_METRIC_DEFINITIONS.resolveCompliance.direction).toBe('higher_is_better');
  });
});
