import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({ postSummaryAsNoteAction: post }));

import PostSummaryAsNoteButton from '@/components/incident/intelligence/PostSummaryAsNoteButton';

const summary = {
  headline: 'Checkout is failing',
  currentState: 'Acknowledged; rollback in progress.',
  impact: '',
  keyEvents: ['Deploy at 10:00'],
  possibleCauses: [],
  nextSteps: ['Confirm rollback'],
};

beforeEach(() => post.mockReset());

describe('PostSummaryAsNoteButton', () => {
  it('posts the summary on screen and then confirms instead of offering a second post', async () => {
    post.mockResolvedValue({ ok: true, done: true, message: 'Summary posted as a note.' });
    render(<PostSummaryAsNoteButton incidentId="inc-1" summary={summary} model="m-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Post summary as note' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('inc-1', { summary, model: 'm-1' }));
    expect(
      await screen.findByText('Summary posted as a note.', {}, { timeout: 5_000 })
    ).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'Post summary as note' })).not.toBeInTheDocument();
  });

  it('announces a permission failure and keeps the button', async () => {
    post.mockResolvedValue({ ok: false, message: 'You do not have permission to do that.' });
    render(<PostSummaryAsNoteButton incidentId="inc-1" summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: 'Post summary as note' }));
    expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(
      'permission'
    );
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Post summary as note' })).toBeEnabled(),
      { timeout: 5_000 }
    );
  });
});
