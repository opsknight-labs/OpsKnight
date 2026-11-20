import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateIncidentSuggestions from '@/components/incident/CreateIncidentSuggestions';
import MetricChangeWhy from '@/components/analytics/MetricChangeWhy';
import StatusDraftSuggestions from '@/components/status-page/StatusDraftSuggestions';
import { loadStatusDraftsAction } from '@/app/(app)/settings/status-pages/helper-actions';
import { suggestForIncidentDraftAction } from '@/app/(app)/incidents/helper-actions';
import { explainMetricChangeAction } from '@/app/(app)/insights/helper-actions';

vi.mock('@/app/(app)/incidents/helper-actions', () => ({
  suggestForIncidentDraftAction: vi.fn(),
}));
vi.mock('@/app/(app)/insights/helper-actions', () => ({
  explainMetricChangeAction: vi.fn(),
}));

vi.mock('@/app/(app)/settings/status-pages/helper-actions', () => ({
  loadStatusDraftsAction: vi.fn(),
}));

const suggest = vi.mocked(suggestForIncidentDraftAction);
const explain = vi.mocked(explainMetricChangeAction);

describe('CreateIncidentSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    suggest.mockResolvedValue({
      service: { id: 'svc-pay', name: 'Payments', matches: 3 },
      urgency: { value: 'HIGH', matches: 3 },
      duplicate: {
        incidentId: 'inc-1',
        title: 'Checkout 500s',
        status: 'OPEN',
        serviceName: 'Payments',
        similarity: 0.8,
      },
    } as Awaited<ReturnType<typeof suggestForIncidentDraftAction>>);
  });
  afterEach(() => vi.useRealTimers());

  const renderWith = (title: string, onPickService = vi.fn()) =>
    render(
      <CreateIncidentSuggestions
        title={title}
        serviceId=""
        urgency="LOW"
        getDescription={() => undefined}
        selectableServiceIds={new Set(['svc-pay'])}
        onPickService={onPickService}
        onPickUrgency={vi.fn()}
      />
    );

  it('asks nothing for a short title and renders nothing', async () => {
    const { container } = renderWith('db');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(suggest).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('debounces typing into one request and offers the suggestions as form fills', async () => {
    const onPickService = vi.fn();
    const { rerender } = renderWith('checkout retu', onPickService);
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender(
      <CreateIncidentSuggestions
        title="checkout returns 500"
        serviceId=""
        urgency="LOW"
        getDescription={() => undefined}
        selectableServiceIds={new Set(['svc-pay'])}
        onPickService={onPickService}
        onPickUrgency={vi.fn()}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(600));

    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'checkout returns 500' })
    );
    expect(screen.getByRole('link', { name: 'Checkout 500s' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use service Payments' }));
    expect(onPickService).toHaveBeenCalledWith('svc-pay');
    expect(screen.getByRole('button', { name: 'Set urgency to High' })).toBeInTheDocument();
  });

  it('links the possible duplicate to the mobile incident page on /m', async () => {
    render(
      <CreateIncidentSuggestions
        title="checkout returns 500"
        serviceId=""
        urgency="LOW"
        getDescription={() => undefined}
        selectableServiceIds={new Set(['svc-pay'])}
        onPickService={vi.fn()}
        onPickUrgency={vi.fn()}
        incidentHrefBase="/m/incidents"
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByRole('link', { name: 'Checkout 500s' })).toHaveAttribute(
      'href',
      '/m/incidents/inc-1'
    );
  });
});

describe('MetricChangeWhy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    explain.mockResolvedValue({ detail: 'Incident count went from 7 to 18.', phrasing: null });
  });

  it('shows the line and asks the server only when a person expands it', async () => {
    render(
      <MetricChangeWhy metric="incidents" line="Most of the rise: Payments +10" windowDays={7} />
    );
    expect(screen.getByText('Most of the rise: Payments +10')).toBeInTheDocument();
    expect(explain).not.toHaveBeenCalled();

    const why = screen.getByRole('button', { name: 'Why?' });
    await act(async () => fireEvent.click(why));
    expect(explain).toHaveBeenCalledWith({ metric: 'incidents', windowDays: 7 });
    expect(await screen.findByText(/Incident count went from 7 to 18\./)).toBeInTheDocument();
    expect(why).toHaveAttribute('aria-expanded', 'true');

    await act(async () => fireEvent.click(why));
    await act(async () => fireEvent.click(why));
    expect(explain).toHaveBeenCalledTimes(1);
  });
});

describe('StatusDraftSuggestions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when no open incident touches the page', async () => {
    vi.mocked(loadStatusDraftsAction).mockResolvedValue([]);
    const { container } = render(<StatusDraftSuggestions statusPageId="p1" onApply={vi.fn()} />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('fills the form from a chosen incident and names the components it selected', async () => {
    const draft = {
      incidentId: 'inc-1',
      incidentTitle: 'api pods crashlooping',
      type: 'INCIDENT' as const,
      title: 'Degraded Website',
      message: 'We are investigating.',
      affected: [
        { serviceId: 'web', name: 'Website', reason: 'DEPENDS_ON_SOURCE' as const },
        { serviceId: 'db', name: 'Database', reason: 'SOURCE' as const },
      ],
    };
    vi.mocked(loadStatusDraftsAction).mockResolvedValue([draft]);
    const onApply = vi.fn();
    render(<StatusDraftSuggestions statusPageId="p1" onApply={onApply} />);

    fireEvent.click(await screen.findByRole('button', { name: 'api pods crashlooping' }));

    expect(onApply).toHaveBeenCalledWith(draft);
    expect(
      screen.getByText(
        'Draft filled in below for Website, Database. Review the wording before you publish.'
      )
    ).toBeInTheDocument();
  });
});
