import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import FeedbackReviewList, {
  type FeedbackReviewRow,
} from '@/app/(app)/settings/intelligence/ai/feedback/FeedbackReviewList';

const row: FeedbackReviewRow = {
  id: 'fb_1',
  createdAt: '2026-11-23T10:00:00.000Z',
  rating: 'DOWN',
  mode: 'ai',
  intent: null,
  reason: 'wrong_facts: the pool limit is 200',
  reviewStatus: 'NEW',
  incident: { id: 'inc_1', title: 'Pool exhausted' },
  service: { id: 'svc_1', name: 'Checkout' },
};

function setup() {
  const actions = {
    learn: vi.fn(async () => ({
      ok: true as const,
      message: 'Review the fact below and confirm it to save it.',
      proposal: {
        token: 'sealed',
        action: 'learn_service_fact',
        kind: 'WRITE' as const,
        title: 'Remember a fact about Checkout',
        detail: 'The pool limit is 200 connections.',
        incidentId: 'inc_1',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    })),
    evalCase: vi.fn(async () => ({
      ok: true as const,
      message: 'Add this to tests/evals/squire/model-cases.ts.',
      json: '{ "question": "TODO" }',
    })),
    dismiss: vi.fn(async () => ({ ok: true as const, message: 'Dismissed.' })),
    markLearned: vi.fn(async () => ({ ok: true as const, message: 'Marked as learned.' })),
  };
  render(
    <FeedbackReviewList
      rows={[row]}
      actions={actions as unknown as ComponentProps<typeof FeedbackReviewList>['actions']}
      assistantName="Pip"
    />
  );
  return { actions, item: screen.getByRole('listitem') };
}

afterEach(() => vi.unstubAllGlobals());

describe('FeedbackReviewList', () => {
  it('keeps the eval case on screen and marks the row learned once it is shown', async () => {
    const { actions, item } = setup();
    fireEvent.click(within(item).getByRole('button', { name: 'Add to eval set' }));
    expect(await within(item).findByLabelText('Evaluation case')).toHaveValue(
      '{ "question": "TODO" }'
    );
    await waitFor(() => expect(actions.markLearned).toHaveBeenCalledWith('fb_1', 'eval_case'));
    expect(await within(item).findByText('Learned')).toBeInTheDocument();
    expect(within(item).getByLabelText('Evaluation case')).toBeInTheDocument();
  });

  it('shows the fact card and marks the row learned only after the card is confirmed', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, message: 'Saved.' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { actions, item } = setup();
    fireEvent.click(within(item).getByRole('button', { name: 'Learn for this service' }));
    expect(within(item).getByLabelText('Fact Pip should remember about Checkout')).toHaveValue(
      'the pool limit is 200'
    );
    fireEvent.click(within(item).getByRole('button', { name: 'Propose fact' }));
    const card = await within(item).findByRole('group', {
      name: 'Suggested action: Remember a fact about Checkout',
    });
    expect(actions.learn).toHaveBeenCalledWith('fb_1', 'the pool limit is 200');
    expect(actions.markLearned).not.toHaveBeenCalled();
    expect(within(item).getByText('New')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(actions.markLearned).toHaveBeenCalledWith('fb_1', 'learn_candidate')
    );
    expect(await within(item).findByText('Learned')).toBeInTheDocument();
    expect(within(card).getByText('Saved.')).toBeInTheDocument();
  });

  it('dismisses and shows the new status', async () => {
    const { actions, item } = setup();
    fireEvent.click(within(item).getByRole('button', { name: 'Dismiss' }));
    expect(await within(item).findByText('Dismissed.')).toBeInTheDocument();
    expect(actions.dismiss).toHaveBeenCalledWith('fb_1');
    expect(within(item).getByText('Dismissed')).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    expect(actions.markLearned).not.toHaveBeenCalled();
  });
});
