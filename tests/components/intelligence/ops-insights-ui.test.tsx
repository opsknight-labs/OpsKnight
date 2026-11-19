import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const decideInsightAction = vi.fn();
const phraseInsightsAction = vi.fn();
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({
  decideInsightAction: (...args: unknown[]) => decideInsightAction(...args),
  phraseInsightsAction: (...args: unknown[]) => phraseInsightsAction(...args),
}));
const openSquire = vi.fn();
vi.mock('@/components/squire/squire-bus', () => ({
  openSquire: (...args: unknown[]) => openSquire(...args),
}));

import InsightBadge from '@/components/intelligence/insights/InsightBadge';
import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';
import InsightsPanel, {
  type InsightsPanelItem,
} from '@/components/intelligence/insights/InsightsPanel';

const insight = (overrides: Partial<InsightsPanelItem> = {}): InsightsPanelItem => ({
  id: 'ins-1',
  scopeType: 'SERVICE',
  scopeId: 'svc-1',
  kind: 'integration.health',
  key: 'silent',
  area: 'automation',
  severity: 'WARNING',
  status: 'OPEN',
  title: 'No alerts for 3 days',
  summary: 'This service used to send about 4 alerts a day.',
  evidence: {
    window: 'the 7 days before the last alert',
    facts: [{ label: 'Usual alerts per day', value: '4' }],
    examples: [{ label: 'Integrations', href: '/services/svc-1/integrations' }],
  },
  draftHref: '/services/svc-1/integrations',
  firstSeenAt: new Date('2026-06-01T00:00:00Z'),
  lastSeenAt: new Date('2026-06-02T00:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  decideInsightAction.mockResolvedValue({ ok: true, status: 'DISMISSED', message: 'Dismissed.' });
});

describe('InsightBadge', () => {
  it('renders nothing when there is nothing open', () => {
    const { container } = render(
      <>
        <InsightBadge />
        <InsightBadge count={null} />
        <InsightBadge count={{ open: 0, highest: 'INFO' }} />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count with the highest severity in its name and tone', () => {
    render(<InsightBadge count={{ open: 3, highest: 'CRITICAL' }} />);
    const badge = screen.getByRole('img', {
      name: '3 open insights, highest severity critical',
    });
    expect(badge).toHaveTextContent('3');
    expect(badge).toHaveAttribute('data-variant', 'danger');
  });

  it('caps a large count', () => {
    render(<InsightBadge count={{ open: 250, highest: 'INFO' }} />);
    expect(screen.getByRole('img')).toHaveTextContent('99+');
  });
});

describe('InsightsPanel', () => {
  it('renders nothing when there are no insights', () => {
    const { container } = render(<InsightsPanel insights={[]} canDecide />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists insights with severity, the scope link and a draft link that only navigates', () => {
    render(
      <InsightsPanel
        insights={[insight({ scopeName: 'Checkout', scopeHref: '/services/svc-1' })]}
        canDecide
        squireName="Squire"
      />
    );
    const row = within(screen.getByRole('list', { name: 'Insights' })).getByRole('listitem');
    expect(within(row).getByText('Warning')).toBeInTheDocument();
    expect(within(row).getByText('No alerts for 3 days')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      '/services/svc-1'
    );
    expect(within(row).getByRole('link', { name: 'Create draft' })).toHaveAttribute(
      'href',
      '/services/svc-1/integrations'
    );
    expect(decideInsightAction).not.toHaveBeenCalled();
  });

  it('shows the evidence on request', async () => {
    render(<InsightsPanel insights={[insight()]} canDecide />);
    expect(screen.queryByText('Usual alerts per day')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    expect(await screen.findByText('Usual alerts per day')).toBeInTheDocument();
    expect(screen.getByText('Measured over the 7 days before the last alert.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/services/svc-1/integrations'
    );
  });

  it('dismisses through the server action, announces the result and refreshes', async () => {
    render(<InsightsPanel insights={[insight()]} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(decideInsightAction).toHaveBeenCalledWith('ins-1', 'dismiss'));
    expect(await screen.findByRole('status')).toHaveTextContent('Dismissed.');
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('keeps the row as it was and says why when the action fails', async () => {
    decideInsightAction.mockResolvedValue({
      ok: false,
      status: null,
      message: 'That insight is no longer available.',
    });
    render(<InsightsPanel insights={[insight()]} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('That insight is no longer available.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('offers no decision to a viewer without the capability, and no Squire hand-off while it is off', () => {
    render(<InsightsPanel insights={[insight()]} canDecide={false} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask/ })).not.toBeInTheDocument();
  });

  it('hands the insight to Squire as a question, without calling a model itself', () => {
    render(
      <InsightsPanel
        insights={[insight({ scopeName: 'Checkout', scopeHref: '/services/svc-1' })]}
        canDecide
        squireName="Squire"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Squire about this' }));
    expect(openSquire).toHaveBeenCalledTimes(1);
    expect(openSquire.mock.calls[0][0]).toContain('service Checkout');
    expect(openSquire.mock.calls[0][0]).toContain('No alerts for 3 days');
  });
});

describe('InsightsPanel plain-language phrasing', () => {
  const scope = { type: 'SERVICE', id: 'svc-1' } as const;

  it('offers no phrasing without a scope and asks nothing until expanded', () => {
    const { rerender } = render(<InsightsPanel insights={[insight()]} canDecide={false} />);
    expect(screen.queryByRole('button', { name: 'Explain in plain words' })).toBeNull();
    rerender(<InsightsPanel insights={[insight()]} canDecide={false} phraseScope={scope} />);
    expect(screen.getByRole('button', { name: 'Explain in plain words' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(phraseInsightsAction).not.toHaveBeenCalled();
  });

  it('asks once on the first expand and shows the phrases', async () => {
    phraseInsightsAction.mockResolvedValue({ phrases: { 'ins-1': 'Alerts stopped arriving.' } });
    render(<InsightsPanel insights={[insight()]} canDecide={false} phraseScope={scope} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain in plain words' }));
    expect(await screen.findByText('Alerts stopped arriving.')).toBeInTheDocument();
    expect(phraseInsightsAction).toHaveBeenCalledWith(scope);

    fireEvent.click(screen.getByRole('button', { name: 'Hide plain-language version' }));
    expect(screen.queryByText('Alerts stopped arriving.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Explain in plain words' }));
    expect(screen.getByText('Alerts stopped arriving.')).toBeInTheDocument();
    expect(phraseInsightsAction).toHaveBeenCalledTimes(1);
  });

  it('shows the notice when nothing could be phrased', async () => {
    phraseInsightsAction.mockResolvedValue({ phrases: {}, notice: 'Budget used up.' });
    render(<InsightsPanel insights={[insight()]} canDecide={false} phraseScope={scope} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain in plain words' }));
    expect(await screen.findByText('Budget used up.')).toBeInTheDocument();
    expect(screen.queryByText(/Written by AI/)).toBeNull();
  });
});

describe('NeedsAttention with operations insights', () => {
  it('ranks probes and insights in one list under one title, most severe first', () => {
    render(
      <NeedsAttention
        items={[
          {
            id: 'dependencies',
            kind: 'dependencies',
            title: '4 observed dependencies to review',
            detail: 'Inferred from incidents that keep occurring together.',
            href: '/settings/intelligence/services#dependencies',
          },
        ]}
        insights={[
          insight({ id: 'warn', severity: 'WARNING', title: 'No alerts for 3 days' }),
          insight({
            id: 'crit',
            severity: 'CRITICAL',
            title: 'Step 2 never acknowledges',
            scopeName: 'Checkout',
            scopeHref: '/services/svc-1',
          }),
        ]}
        moreInsights
        canDecide
        resolveHref={href => `/m${href}`}
      />
    );
    const section = screen.getByRole('region', { name: 'Needs attention' });
    expect(screen.getAllByRole('heading', { name: 'Needs attention' })).toHaveLength(1);
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Step 2 never acknowledges'),
      expect.stringContaining('No alerts for 3 days'),
      expect.stringContaining('4 observed dependencies'),
    ]);
    expect(within(section).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      '/m/services/svc-1'
    );
    expect(section).toHaveTextContent('3+ items');
    expect(section).toHaveTextContent('Accept or dismiss some to see more.');
  });

  it('renders nothing when both sources are empty', () => {
    const { container } = render(<NeedsAttention items={[]} insights={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
