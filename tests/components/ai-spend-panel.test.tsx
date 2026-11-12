import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/(app)/settings/intelligence/ai/cost-actions', () => ({
  saveBudgetAction: vi.fn(),
  deleteBudgetAction: vi.fn(),
  saveModelPriceAction: vi.fn(),
  deleteModelPriceAction: vi.fn(),
}));

import AiSpendPanel from '@/components/settings/AiSpendPanel';
import { AiBudgetsForm, AiModelPricesForm } from '@/components/settings/AiCostForms';
import type { BudgetStatus, SpendBreakdown } from '@/lib/intelligence/ai/cost';

const slice = (key: string, label: string, tokens: number, costMicros: number, unpriced = 0) => ({
  key,
  label,
  requests: 1,
  tokens,
  costMicros,
  unpricedRequests: unpriced,
  cacheHits: 0,
  savedMicros: 0,
});

const breakdown: SpendBreakdown = {
  days: 7,
  from: '2026-10-30',
  to: '2026-11-05',
  daily: [
    { day: '2026-11-04', tokens: 0, costMicros: 0 },
    { day: '2026-11-05', tokens: 950, costMicros: 2_100_000 },
  ],
  byTeam: [slice('t1', 'Payments', 800, 2_000_000), slice('', 'No team', 150, 100_000, 1)],
  byCapability: [slice('SQUIRE_CHAT', 'SQUIRE_CHAT', 950, 2_100_000)],
  byModel: [slice('OPENAI:gpt-4o', 'gpt-4o', 950, 2_100_000)],
  total: {
    requests: 2,
    tokens: 950,
    costMicros: 2_100_000,
    unpricedRequests: 1,
    cacheHits: 0,
    savedMicros: 0,
    cacheReadTokens: 0,
    savedTokens: 0,
  },
};

const statuses: BudgetStatus[] = [
  {
    key: 'global',
    scope: 'GLOBAL',
    label: 'All AI usage',
    tokens: 950,
    costMicros: 0,
    dailyTokenLimit: 10_000,
    dailyCostLimitMicros: null,
    utilization: 0.095,
  },
  {
    key: 'team:t1',
    scope: 'TEAM',
    label: 'Payments',
    tokens: 800,
    costMicros: 2_000_000,
    dailyTokenLimit: null,
    dailyCostLimitMicros: 2_000_000,
    utilization: 1,
  },
  {
    key: 'capability:DIAGNOSE',
    scope: 'CAPABILITY',
    label: 'DIAGNOSE',
    tokens: 850,
    costMicros: 0,
    dailyTokenLimit: 1000,
    dailyCostLimitMicros: null,
    utilization: 0.85,
  },
];

describe('AiSpendPanel', () => {
  it('shows what the caches saved only when there is something to show', () => {
    const { rerender } = render(<AiSpendPanel breakdown={breakdown} statuses={statuses} />);
    expect(screen.queryByText('Saved by cache')).toBeNull();
    rerender(
      <AiSpendPanel
        breakdown={{
          ...breakdown,
          byCapability: [
            {
              ...slice('SUMMARIZE', 'SUMMARIZE', 950, 2_100_000),
              cacheHits: 3,
              savedMicros: 400_000,
            },
          ],
          total: { ...breakdown.total, cacheHits: 3, savedMicros: 400_000, cacheReadTokens: 1200 },
        }}
        statuses={statuses}
      />
    );
    const saved = screen.getByTestId('ai-spend-saved');
    expect(saved).toHaveTextContent('Saved by cache');
    expect(saved).toHaveTextContent('$0.40');
    expect(saved).toHaveTextContent('3 reused answers');
    expect(saved).toHaveTextContent('1,200 cached prompt tokens');
    expect(screen.getByRole('table', { name: 'AI spend by capability' })).toHaveTextContent(
      'saved $0.40'
    );
  });

  it('shows totals, a 7/30 day switch and spend by team, capability and model as tables', () => {
    render(<AiSpendPanel breakdown={breakdown} statuses={statuses} />);
    expect(screen.getByText('Spend, last 7 days')).toBeInTheDocument();
    expect(screen.getAllByText('$2.10').length).toBeGreaterThan(0);
    const period = screen.getByRole('navigation', { name: 'Spend period' });
    const links = within(period).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/settings/intelligence/ai?spend=7#ai-spend',
      '/settings/intelligence/ai?spend=30#ai-spend',
    ]);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    const teams = screen.getByRole('table', { name: 'AI spend by team' });
    expect(within(teams).getByRole('rowheader', { name: 'Payments' })).toBeInTheDocument();
    expect(within(teams).getAllByRole('row')[1]).toHaveTextContent('$2.00');
    expect(screen.getByRole('table', { name: 'AI spend by capability' })).toHaveTextContent(
      'SQUIRE_CHAT'
    );
    expect(screen.getByRole('table', { name: 'AI spend by model' })).toHaveTextContent('gpt-4o');
    expect(screen.getByText(/requests used a model without a price/)).toBeInTheDocument();
    const daily = screen.getByRole('table', { name: 'AI spend per UTC day' });
    expect(within(daily).getAllByRole('row')).toHaveLength(3);
  });

  it('colours budgets at 80% and 100% and exposes utilisation as meters', () => {
    render(<AiSpendPanel breakdown={breakdown} statuses={statuses} />);
    const meters = screen.getAllByRole('meter');
    expect(meters.map(meter => meter.getAttribute('aria-valuenow'))).toEqual(['10', '100', '85']);
    expect(meters[1].firstElementChild).toHaveClass('bg-destructive');
    expect(meters[2].firstElementChild).toHaveClass('bg-amber-500');
    expect(meters[0].firstElementChild).toHaveClass('bg-primary/70');
    expect(screen.getByText(/\$2\.00 \/ \$2\.00 \(100%\)/)).toBeInTheDocument();
  });

  it('renders an empty period without bars or slices', () => {
    render(
      <AiSpendPanel
        breakdown={{
          ...breakdown,
          days: 30,
          daily: [{ day: '2026-11-05', tokens: 0, costMicros: 0 }],
          byTeam: [],
          byCapability: [],
          byModel: [],
          total: { ...breakdown.total, requests: 0, tokens: 0, costMicros: 0, unpricedRequests: 0 },
        }}
        statuses={[]}
      />
    );
    expect(screen.getAllByText('No usage in this period.')).toHaveLength(3);
    expect(screen.queryByText(/without a price/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('AiBudgetsForm and AiModelPricesForm', () => {
  const budget = {
    id: 'b1',
    key: 'team:t1',
    scope: 'TEAM' as const,
    teamId: 't1',
    capability: null,
    label: 'Payments',
    dailyTokenLimit: 1000,
    dailyCostLimitMicros: 2_500_000,
    enabled: true,
    revision: 3,
  };

  it('lists budgets and hides editing controls from readers', () => {
    render(
      <AiBudgetsForm
        budgets={[budget]}
        teams={[{ id: 't1', name: 'Payments' }]}
        canManage={false}
      />
    );
    expect(screen.getByText('1,000 tokens and $2.50 per day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /budget/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Add a budget')).not.toBeInTheDocument();
  });

  it('lets managers edit with the current revision and add a new budget', () => {
    const { container } = render(
      <AiBudgetsForm budgets={[budget]} teams={[{ id: 't1', name: 'Payments' }]} canManage />
    );
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add budget' })).toBeInTheDocument();
    const revisions = [...container.querySelectorAll('input[name="expectedRevision"]')].map(
      input => (input as HTMLInputElement).value
    );
    expect(revisions).toEqual(['3', '3', '0']);
    expect(screen.getByRole('option', { name: 'Payments' })).toBeInTheDocument();
  });

  it('shows which price each configured model uses', () => {
    render(
      <AiModelPricesForm
        configured={[
          {
            providerKind: 'OPENAI',
            model: 'gpt-4o',
            provider: 'Main',
            inputUsdPerMTok: 2.5,
            outputUsdPerMTok: 10,
            source: 'built-in',
          },
          {
            providerKind: 'OPENAI_COMPATIBLE',
            model: 'llama',
            provider: 'Local',
            inputUsdPerMTok: null,
            outputUsdPerMTok: null,
            source: null,
          },
        ]}
        overrides={[]}
        canManage
      />
    );
    const table = screen.getByRole('table', { name: 'Prices used for configured models' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('$2.5');
    expect(rows[1]).toHaveTextContent('List price');
    expect(rows[2]).toHaveTextContent('unpriced');
    expect(screen.getByRole('button', { name: 'Add price' })).toBeInTheDocument();
  });
});
