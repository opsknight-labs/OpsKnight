import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rate = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({ rateSimilarIncident: rate }));

import SimilarIncidentFeedback from '@/components/incident/SimilarIncidentFeedback';

function setup(initial: 'HELPFUL' | 'NOT_HELPFUL' | null = null) {
  rate.mockReset();
  rate.mockImplementation(async (_incident: string, _prev: unknown, form: FormData) => {
    const verdict = form.get('verdict');
    return { ok: true, message: '', verdict: verdict === 'REVOKE' ? null : verdict };
  });
  return render(<SimilarIncidentFeedback incidentId="inc-1" findingId="f-1" initialVerdict={initial} />);
}
const submitted = (call = 0) => {
  const [, , form] = rate.mock.calls.slice(call, call + 1)[0] ?? [];
  return Object.fromEntries((form as FormData).entries());
};

describe('SimilarIncidentFeedback', () => {
  it('renders both buttons unpressed when there is no verdict', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the saved verdict state', () => {
    setup('HELPFUL');
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('submits a positive verdict for the right finding', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() => expect(rate).toHaveBeenCalledTimes(1));
    expect(rate.mock.calls[0][0]).toBe('inc-1');
    expect(submitted()).toEqual({ findingId: 'f-1', verdict: 'HELPFUL' });
  });

  it('asks for an optional reason before recording negative feedback', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(rate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unrelated' }));
    await waitFor(() => expect(rate).toHaveBeenCalledTimes(1));
    expect(submitted()).toEqual({ findingId: 'f-1', verdict: 'NOT_HELPFUL', reasonCode: 'UNRELATED' });
  });

  it('lets the person skip the reason', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(rate).toHaveBeenCalledTimes(1));
    expect(submitted()).toEqual({ findingId: 'f-1', verdict: 'NOT_HELPFUL' });
  });

  it('withdraws feedback when the same button is pressed again', async () => {
    setup('HELPFUL');
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() => expect(rate).toHaveBeenCalledTimes(1));
    expect(submitted()).toEqual({ findingId: 'f-1', verdict: 'REVOKE' });
  });

  it('shows an error and keeps the previous state when saving fails', async () => {
    setup('HELPFUL');
    rate.mockImplementation(async () => ({ ok: false, message: 'Try again later.', verdict: 'HELPFUL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'true'));
  });
});
