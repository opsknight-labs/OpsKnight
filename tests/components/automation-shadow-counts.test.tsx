import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  emptyCounts,
  sumShadowAggregates,
  calculateDeduplicatedFailures,
} from '@/components/automation/workspace/shadow-counts';
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

  it('deduplicates overlapping errors and fallbacks to prevent double-counting failed evaluations', () => {
    // Exact overlap where each fallback event increments both error and fallback (e.g., 3 failed evals)
    expect(calculateDeduplicatedFailures(3, 3)).toBe(3);
    // Fallback only (e.g., 4 fallbacks)
    expect(calculateDeduplicatedFailures(0, 4)).toBe(4);
    // Error only (e.g., 2 errors)
    expect(calculateDeduplicatedFailures(2, 0)).toBe(2);
    // Asymmetric failure counts
    expect(calculateDeduplicatedFailures(2, 5)).toBe(5);
    expect(calculateDeduplicatedFailures(4, 1)).toBe(4);
    // Zero failures
    expect(calculateDeduplicatedFailures(0, 0)).toBe(0);
    expect(calculateDeduplicatedFailures(undefined, undefined)).toBe(0);
  });
});

describe('AutomationOverview Fallback / Error Display & Readiness Certification', () => {
  const baseData: Data = {
    enabled: true,
    mode: 'SHADOW',
    canPublish: true,
    canEdit: true,
    canReadSensitive: true,
    activeVersionId: 'v1',
    activeVersion: {
      id: 'v1',
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      serviceId: 's1',
      status: 'PUBLISHED',
      snapshot: emptySnapshot,
    },
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
    versionTotal: 1,
    unmappedCount: 0,
  } as unknown as Data;

  it('displays Zero failures and passes LIVE-readiness when both errors and fallbacks are 0', () => {
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
    expect(screen.getByText('5 / 5 checks ready')).toBeInTheDocument();
    expect(screen.getByText('No recorded Shadow fallbacks/errors')).toBeInTheDocument();
  });

  it('displays fallback counts, shows failure segment in parity bar, and blocks LIVE readiness when fallbacks exist', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 6,
      priorities: 0,
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

    // Main KPI card
    expect(screen.getAllByText('Fallbacks / errors')[0]).toBeInTheDocument();
    expect(screen.queryByText('Zero failures')).not.toBeInTheDocument();
    expect(screen.getByText('4 fallbacks')).toBeInTheDocument();

    // Parity Bar
    expect(screen.getByText('Errors / fallbacks (4)')).toBeInTheDocument();

    // LIVE readiness checklist must NOT pass and must not claim 0 errors
    expect(screen.queryByText('No recorded Shadow fallbacks/errors')).not.toBeInTheDocument();
    expect(screen.getByText('4 fallbacks require review')).toBeInTheDocument();
    expect(screen.getByText('4 / 5 checks ready')).toBeInTheDocument();
  });

  it('deduplicates overlapping errors and fallbacks so 3 failed evaluations do not appear as 6 failures', () => {
    // 3 failed evaluations caused runtime to increment both errors and fallbacks
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 7,
      priorities: 0,
      skips: 0,
      errors: 3,
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

    // Must NOT display 6 as the total failures
    expect(screen.queryByText('6')).not.toBeInTheDocument();

    // Main KPI displays deduplicated count (3) and breakdown
    expect(screen.getByText('3 err · 3 fallback')).toBeInTheDocument();

    // Parity bar displays deduplicated count (3)
    expect(screen.getByText('Errors / fallbacks (3)')).toBeInTheDocument();

    // Readiness checklist accounts for deduplicated failures
    expect(screen.getByText('3 fallbacks/errors require review')).toBeInTheDocument();
    expect(screen.getByText('4 / 5 checks ready')).toBeInTheDocument();
  });

  it('handles asymmetric failure counts (e.g., 2 errors, 3 fallbacks)', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 7,
      priorities: 0,
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

    // Deduplicated count is max(2, 3) = 3 (not 5)
    expect(screen.getByText('2 err · 3 fallback')).toBeInTheDocument();
    expect(screen.getByText('Errors / fallbacks (3)')).toBeInTheDocument();
    expect(screen.getByText('3 fallbacks/errors require review')).toBeInTheDocument();
    expect(screen.getByText('4 / 5 checks ready')).toBeInTheDocument();
  });

  it('handles error-only failures correctly', () => {
    const counts: Counts = {
      evaluated: 50,
      same: 40,
      routes: 8,
      priorities: 0,
      skips: 0,
      errors: 2,
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

    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByText('Errors / fallbacks (2)')).toBeInTheDocument();
    expect(screen.getByText('2 errors require review')).toBeInTheDocument();
    expect(screen.getByText('4 / 5 checks ready')).toBeInTheDocument();
  });
});
