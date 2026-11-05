import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReviewForm from '@/app/(app)/settings/integrations/mcp/approvals/ReviewForm';
import {
  RequesterStatus,
  RequestedBy,
} from '@/app/(app)/settings/integrations/mcp/approvals/review-gate';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ signOut }));
afterEach(cleanup);

const base = {
  hidden: { id: 'c1', operationDigest: 'a'.repeat(64) },
  noun: 'change',
  approveLabel: 'Approve frozen change',
  rejectLabel: 'Reject change',
  reviewPath: '/settings/integrations/mcp/approvals/operations/c1',
};

describe('review form', () => {
  it('shows an expected refusal inline instead of failing the page', async () => {
    const action = vi.fn(async (_previous: unknown, _form: FormData) => ({
      ok: false as const,
      code: 'MCP_APPROVAL_EXPIRED',
    }));
    render(<ReviewForm {...base} action={action} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve frozen change/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer open');
    const form = action.mock.calls[0]![1];
    expect(form.get('decision')).toBe('approve');
    expect(form.get('id')).toBe('c1');
  });

  it('confirms the decision once it is recorded', async () => {
    const action = vi.fn(async (_previous: unknown, _form: FormData) => ({
      ok: true as const,
      decision: 'reject' as const,
    }));
    render(<ReviewForm {...base} action={action} />);
    fireEvent.change(screen.getByLabelText(/Note to the requester/), {
      target: { value: 'Wrong service' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject change' }));
    expect(await screen.findByRole('status')).toHaveTextContent('You rejected this change.');
    const form = action.mock.calls[0]![1];
    expect(form.get('reason')).toBe('Wrong service');
  });

  it('does not claim the requester was notified when they reviewed their own request', async () => {
    const approve = async (_previous: unknown, _form: FormData) => ({
      ok: true as const,
      decision: 'approve' as const,
    });
    render(<ReviewForm {...base} action={vi.fn(approve)} selfReview />);
    fireEvent.click(screen.getByRole('button', { name: /Approve frozen change/ }));
    const own = await screen.findByRole('status');
    expect(own).not.toHaveTextContent('notified');
    expect(own).toHaveTextContent('Your assistant can now apply it once.');
    cleanup();
    render(<ReviewForm {...base} action={vi.fn(approve)} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve frozen change/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The requester was notified in OpsKnight. Their assistant can now apply it once.'
    );
  });

  it('replaces Approve with a re-sign-in that returns to the review page when sign-in is stale', async () => {
    render(<ReviewForm {...base} action={vi.fn()} freshSignInRequired />);
    expect(screen.queryByRole('button', { name: /Approve frozen change/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reject change' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm it.s you/ }));
    await waitFor(() =>
      expect(signOut).toHaveBeenCalledWith({
        callbackUrl: `/login?callbackUrl=${encodeURIComponent(base.reviewPath)}`,
      })
    );
  });
});

describe('requester views', () => {
  it('names who asked and through which assistant', () => {
    render(
      <RequestedBy
        person={{ name: 'Rita', email: 'rita@example.com' }}
        assistant={{ name: 'Claude' }}
        at={new Date('2026-11-04T12:00:00Z')}
      />
    );
    expect(screen.getByText(/Requested by/)).toHaveTextContent(
      'Requested by Rita (rita@example.com) via the assistant “Claude” at 2026-11-04T12:00:00.000Z'
    );
  });

  it('shows a rejected request with the reviewer and their note, and no review controls', () => {
    render(
      <RequesterStatus
        heading="Your requested configuration change"
        status="REJECTED"
        expiresAt={new Date('2026-11-04T16:00:00Z')}
        reviewer={{ name: 'Ada', email: null }}
        decidedAt={new Date('2026-11-04T12:30:00Z')}
        selfApproved={false}
        decisionReason="Use the staging gateway first"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Status: Rejected');
    expect(screen.getByText(/by Ada/)).toBeInTheDocument();
    expect(screen.getByText('Use the staging gateway first')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
