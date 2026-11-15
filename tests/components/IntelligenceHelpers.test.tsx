import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateIncidentSuggestions from '@/components/incident/CreateIncidentSuggestions';
import MetricChangeWhy from '@/components/analytics/MetricChangeWhy';
import { suggestForIncidentDraftAction } from '@/app/(app)/incidents/helper-actions';
import { explainMetricChangeAction } from '@/app/(app)/analytics/helper-actions';

vi.mock('@/app/(app)/incidents/helper-actions', () => ({
  suggestForIncidentDraftAction: vi.fn(),
}));
vi.mock('@/app/(app)/analytics/helper-actions', () => ({
  explainMetricChangeAction: vi.fn(),
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
