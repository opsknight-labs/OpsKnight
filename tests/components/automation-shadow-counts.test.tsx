import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyCounts, sumShadowAggregates } from '@/components/automation/workspace/shadow-counts';
import { AutomationOverview } from '@/components/automation/AutomationOverview';
import type { Data, Counts } from '@/components/automation/presentation-types';
import { emptySnapshot } from '@/lib/automation/contract';

describe('Shadow Counts & Fallback Aggregation', () => {
  it('returns emptyCounts when aggregates array is empty', () => {
    const result = sumShadowAggregates([]);
    expect(result).toEqual(emptyCounts);
    expect(result?.fallbacks).toBe(0);
    expect(result?.errors).toBe(0);
    expect(result?.evaluated).toBe(0);
  });

  it('accurately sums fallback-only scenarios without masking failures under 0 errors', () => {
    const rows = [
      {
        versionId: 'v1',
        evaluated: 10,
        same: 6,
        routeDifferent: 2,
        priorityDifferent: 2,
        noEscalationDifferent: 0,
        errors: 0,
        fallbacks: 4,
      },
    ] as unknown as Data['aggregates'];

    const counts = sumShadowAggregates(rows);
    expect(counts).toBeDefined();
    expect(counts?.evaluated).toBe(10);
    expect(counts?.errors).toBe(0);
    expect(counts?.fallbacks).toBe(4);
  });

  it('accurately sums combined errors and fallbacks across multiple versions', () => {
    const rows = [
      {
        versionId: 'v1',
        evaluated: 20,
        same: 14,
        routeDifferent: 2,
        priorityDifferent: 2,
        noEscalationDifferent: 2,
        errors: 2,
        fallbacks: 3,
      },
      {
        versionId: 'v2',
        evaluated: 15,
        same: 12,
        routeDifferent: 1,
        priorityDifferent: 1,
        noEscalationDifferent: 1,
        errors: 1,
        fallbacks: 2,
      },
    ] as unknown as Data['aggregates'];

    // All versions
    const totalCounts = sumShadowAggregates(rows);
    expect(totalCounts?.evaluated).toBe(35);
    expect(totalCounts?.errors).toBe(3);
    expect(totalCounts?.fallbacks).toBe(5);

    // Filtered by version v2 only
    const v2Counts = sumShadowAggregates(rows, 'v2');
    expect(v2Counts?.evaluated).toBe(15);
    expect(v2Counts?.errors).toBe(1);
    expect(v2Counts?.fallbacks).toBe(2);
  });

  it('handles undefined input safely', () => {
    expect(sumShadowAggregates(undefined)).toBeUndefined();
  });
});

describe('AutomationOverview Fallback / Error Display', () => {
  const baseData: Data = {
    enabled: true,
    mode: 'SHADOW',
    canPublish: true,
    canEdit: true,
    canReadSensitive: true,
    activeVersionId: 'v1',
    activeVersion: null,
    candidateVersion: null,
    candidateAggregates: [],
    draft: { snapshot: emptySnapshot, revision: 1 },
    aggregates: [],
    traces: [],
    policies: [],
    destinations: [],
    integrations: [],
    alerts: [],
    observations: [],
    versions: [],
    versionTotal: 0,
    unmappedCount: 0,
  } as unknown as Data;

  it('displays Zero failures when both errors and fallbacks are 0', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 48,
      routes: 2,
      priorities: 0,
      skips: 0,
      errors: 0,
      fallbacks: 0,
    };

    render(
      <AutomationOverview
        data={baseData}
        counts={counts}
        traceFilter="ALL"
        setTraceFilter={vi.fn()}
        setArea={vi.fn()}
      />
    );

    expect(screen.getAllByText('Fallbacks / errors')[0]).toBeInTheDocument();
    expect(screen.getByText('Zero failures')).toBeInTheDocument();
  });

  it('displays fallback counts and does not report Zero failures when fallbacks exist', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 5,
      priorities: 1,
      skips: 0,
      errors: 0,
      fallbacks: 4,
    };

    render(
      <AutomationOverview
        data={baseData}
        counts={counts}
        traceFilter="ALL"
        setTraceFilter={vi.fn()}
        setArea={vi.fn()}
      />
    );

    expect(screen.getAllByText('Fallbacks / errors')[0]).toBeInTheDocument();
    expect(screen.queryByText('Zero failures')).not.toBeInTheDocument();
    expect(screen.getByText('4 fallbacks')).toBeInTheDocument();
  });

  it('displays breakdown when both errors and fallbacks occur', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 5,
      priorities: 1,
      skips: 0,
      errors: 2,
      fallbacks: 3,
    };

    render(
      <AutomationOverview
        data={baseData}
        counts={counts}
        traceFilter="ALL"
        setTraceFilter={vi.fn()}
        setArea={vi.fn()}
      />
    );

    expect(screen.getAllByText('Fallbacks / errors')[0]).toBeInTheDocument();
    expect(screen.queryByText('Zero failures')).not.toBeInTheDocument();
    expect(screen.getByText('2 err · 3 fallback')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
  });
});
