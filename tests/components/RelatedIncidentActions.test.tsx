import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const decide = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  decideRelatedIncident: decide,
}));

import RelatedIncidentActions from '@/components/incident/RelatedIncidentActions';

function setup(decision: 'SUGGESTED' | 'ACCEPTED') {
  decide.mockReset();
  decide.mockImplementation(async (_incident: string, _prev: unknown, form: FormData) => {
    const next = form.get('decision');
    return {
      ok: true,
      message:
        next === 'ACCEPTED'
          ? 'Marked as related.'
          : next === 'REJECTED'
            ? 'Marked as not related.'
            : 'Link removed.',
      decision: next,
    };
  });
  return render(
    <RelatedIncidentActions incidentId="inc-1" relationshipId="rel-1" decision={decision} />
  );
}
const sent = () => Object.fromEntries((decide.mock.calls[0][2] as FormData).entries());

describe('RelatedIncidentActions', () => {
  it('offers confirm and reject for a suggestion', () => {
    setup('SUGGESTED');
    expect(screen.getByRole('button', { name: 'Group these' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not related' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument();
  });

  it('offers only unlink for a confirmed link', () => {
    setup('ACCEPTED');
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Group these' })).not.toBeInTheDocument();
  });

  it('submits the right relationship and decision', async () => {
    setup('SUGGESTED');
    fireEvent.click(screen.getByRole('button', { name: 'Group these' }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0][0]).toBe('inc-1');
    expect(sent()).toEqual({ relationshipId: 'rel-1', decision: 'ACCEPTED' });
    expect(await screen.findByRole('button', { name: 'Unlink' })).toBeInTheDocument();
  });

  it('shows a confirmation and removes the controls once a link is rejected or unlinked', async () => {
    setup('SUGGESTED');
    fireEvent.click(screen.getByRole('button', { name: 'Not related' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Marked as not related.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an error and keeps the controls when saving fails', async () => {
    setup('SUGGESTED');
    decide.mockImplementation(async () => ({
      ok: false,
      message: 'That link is no longer available.',
      decision: 'SUGGESTED',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Group these' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.getByRole('button', { name: 'Group these' })).toBeInTheDocument();
  });
});
