import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/squire/SquireMarkdown', () => ({
  default: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

import SquireChart, { describeChart } from '@/components/squire/SquireChart';
import SquireMessage, { feedbackSubject } from '@/components/squire/SquireMessage';
import { mergeChart, type Turn } from '@/components/squire/chat-types';
import type { SquireChart as Chart } from '@/lib/intelligence/squire/contract';

const chart: Chart = {
  title: 'pool_in_use',
  unit: '%',
  series: [
    {
      name: 'pool=checkout-primary',
      points: [
        { t: '2026-11-23T10:00:00.000Z', v: 40 },
        { t: '2026-11-23T10:01:00.000Z', v: 98 },
      ],
    },
    {
      name: 'pool=checkout-replica',
      points: [
        { t: '2026-11-23T10:00:00.000Z', v: 12.5 },
        { t: '2026-11-23T10:01:00.000Z', v: 10 },
      ],
    },
  ],
  source: { kind: 'observability', id: 'conn_1', label: 'Prod Prometheus' },
};

afterEach(() => vi.unstubAllGlobals());

describe('SquireChart', () => {
  it('is a focusable, described figure with every value in a hidden table', () => {
    render(<SquireChart chart={chart} />);
    const figure = screen.getByRole('figure', { name: 'pool_in_use' });
    expect(figure).toHaveAttribute('tabindex', '0');
    // The description says what the drawing shows, series by series.
    expect(figure).toHaveAccessibleDescription(
      expect.stringMatching(/Line chart, 2 series.*checkout-primary: 40 % to 98 %, lowest 40 %/)
    );
    expect(within(figure).getByText('From Prod Prometheus')).toBeInTheDocument();
    const table = within(figure).getByRole('table', { name: 'pool_in_use: every value' });
    expect(table).toHaveClass('sr-only');
    const rows = within(table).getAllByRole('row');
    // A header row plus one row per point.
    expect(rows).toHaveLength(5);
    expect(within(table).getByText('12.5 %')).toBeInTheDocument();
    expect(within(table).getAllByText('pool=checkout-replica')).toHaveLength(2);
  });

  it('describes a single-series chart without a unit', () => {
    expect(describeChart({ title: 't', series: [chart.series[0]] })).toMatch(
      /1 series .*checkout-primary: 40 to 98, lowest 40, highest 98\./
    );
  });
});

describe('mergeChart', () => {
  it('adds valid charts up to the per-answer cap and ignores anything else', () => {
    expect(mergeChart(undefined, { title: 'x' })).toBeUndefined();
    expect(mergeChart(undefined, { ...chart, script: '<b>' })).toBeUndefined();
    const one = mergeChart(undefined, chart);
    const two = mergeChart(one, chart);
    expect(two).toHaveLength(2);
    expect(mergeChart(two, chart)).toBe(two);
  });
});

const props = {
  index: 1,
  name: 'Pip',
  busy: false,
  last: true,
  animated: false,
  onOutcome: () => undefined,
  onRetry: () => undefined,
  onEdit: () => undefined,
};

describe('SquireMessage', () => {
  it('draws the charts of an answer, including a reopened one', async () => {
    const turn: Turn = {
      role: 'assistant',
      content: 'Pool use jumped.',
      mode: 'ai',
      charts: [chart],
    };
    render(<SquireMessage {...props} turn={turn} />);
    // Loaded lazily, so recharts stays out of the launcher's chunk.
    expect(await screen.findByRole('figure', { name: 'pool_in_use' })).toBeInTheDocument();
  });

  it('asks why on 👎 and sends the reason, the note and the page it was asked on', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const turn: Turn = {
      role: 'assistant',
      content: 'Restart the pool.',
      mode: 'ai',
      incidentId: 'inc_1',
      context: 'incident:inc_1',
    };
    render(<SquireMessage {...props} turn={turn} question="Why is checkout slow?" />);
    fireEvent.click(screen.getByRole('button', { name: 'Unhelpful answer' }));
    const form = screen.getByRole('form', { name: 'Why was this answer not helpful?' });
    const chip = within(form).getByRole('button', { name: 'Wrong facts' });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const note = within(form).getByLabelText(/Anything else/);
    expect(note).toHaveAttribute('maxLength', '300');
    fireEvent.change(note, { target: { value: '  The limit is 200.  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(screen.getByText('Thanks for the feedback.')).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      rating: 'DOWN',
      mode: 'ai',
      reason: 'wrong_facts',
      note: 'The limit is 200.',
      question: 'Why is checkout slow?',
      incidentId: 'inc_1',
    });
  });

  it('keeps focus on the page after Cancel or Send, and sends once', async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => (finish = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    const turn: Turn = { role: 'assistant', content: 'Restart the pool.', mode: 'ai' };
    render(<SquireMessage {...props} turn={turn} />);
    const thumbsDown = screen.getByRole('button', { name: 'Unhelpful answer' });
    fireEvent.click(thumbsDown);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(thumbsDown).toHaveFocus();

    fireEvent.click(thumbsDown);
    const form = screen.getByRole('form', { name: 'Why was this answer not helpful?' });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Sending…' })).toBeDisabled()
    );
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response('{}', { status: 201 }));
    const status = await screen.findByText('Thanks for the feedback.');
    expect(status).toHaveFocus();
  });

  it('draws two series that share a name', async () => {
    const twin: Chart = {
      ...chart,
      series: [chart.series[0], { ...chart.series[1], name: chart.series[0].name }],
    };
    render(<SquireChart chart={twin} />);
    const table = screen.getByRole('table', { name: 'pool_in_use: every value' });
    expect(within(table).getAllByText('pool=checkout-primary')).toHaveLength(4);
  });

  it('reads the incident or service from the page a turn was asked on', () => {
    expect(feedbackSubject({ context: 'service:svc_1' })).toEqual({ serviceId: 'svc_1' });
    expect(feedbackSubject({ context: 'incident:inc_2' })).toEqual({ incidentId: 'inc_2' });
    expect(feedbackSubject({ context: 'general' })).toEqual({});
  });
});
