import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({ decideInsightAction: vi.fn() }));
vi.mock('@/components/squire/squire-bus', () => ({ openSquire: vi.fn() }));
vi.mock('@/lib/intelligence/runbook-health/view', () => ({
  getRunbookHealthView: vi.fn(),
  getMissingRunbookSuggestions: vi.fn(),
}));
vi.mock('@/lib/intelligence/ai/settings', () => ({ getAiPublicStatus: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/runbook-suggestion-actions', () => ({
  draftRunbookFromNotesAction: vi.fn(),
}));

import { RunbookHealthPanel } from '@/components/runbooks/detail/RunbookHealthSection';
import { MissingRunbookList } from '@/components/service/runbooks/MissingRunbookSuggestions';
import type { RunbookHealthView } from '@/lib/intelligence/runbook-health/view';
import type { RunbookEffectiveness } from '@/lib/intelligence/runbook-health/insights';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';

const insight = (overrides: Partial<OpsInsightView> = {}): OpsInsightView => ({
  id: 'ins-1',
  scopeType: 'RUNBOOK',
  scopeId: 'rb-1',
  kind: 'runbook.step_failing',
  key: 'restart',
  area: 'runbooks',
  severity: 'WARNING',
  status: 'OPEN',
  title: 'Step "Restart" fails in 67% of runs',
  summary: 'It failed 4 of 6 times, most often with E_TIMEOUT.',
  evidence: { facts: [] },
  draftHref: '/runbooks/rb-1/edit',
  firstSeenAt: new Date('2026-11-01T00:00:00Z'),
  lastSeenAt: new Date('2026-11-02T00:00:00Z'),
  ...overrides,
});

const effectiveness = (overrides: Partial<RunbookEffectiveness> = {}): RunbookEffectiveness => ({
  windowDays: 90,
  fixWindowMinutes: 120,
  eligible: 6,
  succeeded: 2,
  successRate: 2 / 6,
  successLowerBound: 0.1,
  incidentRuns: 3,
  fixed: 1,
  fixedRate: 1 / 3,
  fixedLowerBound: 0.06,
  medianDurationMs: 90_000,
  mostFailingStep: {
    stepKey: 'restart',
    name: 'Restart',
    runs: 6,
    failed: 4,
    retried: 0,
    topErrorCode: 'E_TIMEOUT',
    topErrorCount: 4,
    failureRate: 4 / 6,
  },
  lastRunAt: new Date('2026-11-10T00:00:00Z'),
  lastEditedAt: null,
  ...overrides,
});

const view = (overrides: Partial<RunbookHealthView> = {}): RunbookHealthView => ({
  effectiveness: effectiveness(),
  insights: [],
  suggestedSteps: {},
  ...overrides,
});

const format = (value: Date) => value.toISOString().slice(0, 10);

describe('RunbookHealthPanel', () => {
  it('renders nothing for a runbook with no runs and no insights', () => {
    const { container } = render(
      <RunbookHealthPanel
        view={view({ effectiveness: effectiveness({ eligible: 0, mostFailingStep: null }) })}
        formatTimestamp={format}
        canDecide
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the rates with their lower bound, the fix window and the most failing step', () => {
    render(<RunbookHealthPanel view={view()} formatTimestamp={format} canDecide />);
    expect(
      screen.getByText('33% (2 of 6 runs), at least 10% with this many runs')
    ).toBeInTheDocument();
    expect(screen.getByText(/resolved within 120 min/)).toBeInTheDocument();
    expect(screen.getByText('Restart: failed 4 of 6, mostly E_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('2026-11-10')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByLabelText('Runbook health insights')).toBeNull();
  });

  it('lists open insights and the suggested steps the viewer may read', () => {
    const missingStep = insight({
      id: 'ins-2',
      kind: 'runbook.missing_step',
      title: 'Responders add the same note after 3 of 4 runs',
    });
    render(
      <RunbookHealthPanel
        view={view({
          insights: [insight(), missingStep],
          suggestedSteps: { 'ins-2': 'Flush the cache' },
        })}
        formatTimestamp={format}
        canDecide={false}
      />
    );
    expect(screen.getByText('Step "Restart" fails in 67% of runs')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Suggested steps' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Flush the cache']);
  });
});

describe('MissingRunbookList', () => {
  const suggestion = {
    insight: insight({
      scopeType: 'SERVICE',
      scopeId: 'svc-1',
      kind: 'runbook.missing',
      title: '3 incidents of one recurring problem were resolved by hand the same way',
    }),
    template: 'Disk full on <host>',
    notes: ['Cleared /tmp and restarted the agent', 'cleared tmp, restarted agent', 'Cleared /tmp'],
    steps: [
      { name: 'Clear /tmp', support: 3 },
      { name: 'Restart the agent', support: 2 },
    ],
  };

  it('renders nothing without suggestions', () => {
    const { container } = render(
      <MissingRunbookList serviceId="svc-1" suggestions={[]} canManage canDecide />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the draft steps and offers the editor only to runbook managers', () => {
    const { rerender } = render(
      <MissingRunbookList serviceId="svc-1" suggestions={[suggestion]} canManage canDecide />
    );
    expect(screen.getByText('Clear /tmp (3 of 3 notes)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a draft in the editor' })).toBeInTheDocument();
    rerender(
      <MissingRunbookList
        serviceId="svc-1"
        suggestions={[suggestion]}
        canManage={false}
        canDecide
      />
    );
    expect(screen.queryByRole('button', { name: 'Open a draft in the editor' })).toBeNull();
  });

  it('keeps the counts but hides drafting when every note is on an unreadable incident', () => {
    render(
      <MissingRunbookList
        serviceId="svc-1"
        suggestions={[{ ...suggestion, template: '', notes: [], steps: [] }]}
        canManage
        canDecide
      />
    );
    expect(
      screen.getByText('The notes behind this are on incidents you cannot open.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open a draft in the editor' })).toBeNull();
  });
});
