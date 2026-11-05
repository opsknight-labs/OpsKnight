import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReviewForm from '@/app/(app)/settings/integrations/mcp/approvals/ReviewForm';
import {
  RequesterStatus,
  RequestedBy,
  ReviewUnavailable,
  SelfApprovalConfirm,
  statusLabel,
} from '@/app/(app)/settings/integrations/mcp/approvals/review-gate';
import { Deadline } from '@/components/settings/mcp/McpListKit';

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
        timeZone="Asia/Kolkata"
      />
    );
    // UX-4: the viewer's own time zone, never raw UTC ISO.
    expect(screen.getByText(/Requested by/)).toHaveTextContent(
      'Requested by Rita (rita@example.com) via the assistant “Claude” at Nov 4, 2026, 5:30 PM GMT+5:30'
    );
    expect(screen.getByText(/Requested by/).textContent).not.toContain('T12:00:00');
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

describe('UX-4 / UX-5 / UX-7 review pages', () => {
  const now = new Date('2026-11-05T09:00:00Z');

  it('shows a deadline in local time with how long is left, and warns near and past it', () => {
    render(<Deadline value={new Date('2026-11-05T09:27:00Z')} now={now} timeZone="Asia/Kolkata" />);
    expect(document.body).toHaveTextContent('Nov 5, 2026, 2:57 PM GMT+5:30 (in 27 minutes)');
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    render(<Deadline value={new Date('2026-11-05T09:10:00Z')} now={now} timeZone="UTC" />);
    expect(screen.getByRole('status')).toHaveTextContent('Less than 15 minutes left');
    cleanup();
    render(<Deadline value={new Date('2026-11-05T08:59:00Z')} now={now} timeZone="UTC" />);
    expect(screen.getByRole('status')).toHaveTextContent('Deadline passed');
  });

  it('uses plain status labels and the shorter expiry copy', () => {
    expect(statusLabel('PENDING')).toBe('Waiting for review');
    expect(statusLabel('COMMITTED')).toBe('Completed');
    render(
      <RequesterStatus
        heading="Your requested configuration change"
        status="EXPIRED"
        expiresAt={now}
        reviewer={null}
        decidedAt={null}
        selfApproved={false}
        decisionReason={null}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'It was not used in time. Ask your assistant to prepare it again.'
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('idempotency');
    expect(screen.getByRole('link', { name: 'Back to approvals' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=approvals'
    );
  });

  it('renders theme-safe notices with a way back to the queue', () => {
    render(<ReviewUnavailable reason="expired" heading="Review requested change" />);
    const notice = screen.getByRole('status');
    expect(notice.className).toMatch(/dark:bg-amber-950/);
    expect(screen.getByRole('link', { name: 'Back to approvals' })).toBeTruthy();
    cleanup();
    render(<SelfApprovalConfirm />);
    const box = screen.getByRole('checkbox', { name: /I have reviewed this change/ });
    expect(box).toHaveAttribute('name', 'confirmSelfApproval');
    expect(box).toBeRequired();
    expect(box.closest('[class*="dark:bg-amber-950"]')).not.toBeNull();
  });

  it('styles the decision buttons like every other action and links back after deciding', async () => {
    const action = vi.fn(async (_previous: unknown, _form: FormData) => ({
      ok: false as const,
      code: 'MCP_APPROVAL_EXPIRED',
    }));
    render(<ReviewForm {...base} action={action} />);
    const reject = screen.getByRole('button', { name: 'Reject change' });
    expect(reject).toHaveAttribute('formnovalidate');
    expect(reject).toHaveAttribute('value', 'reject');
    expect(reject.className).toMatch(/border-input/);
    expect(screen.getByRole('button', { name: /Approve frozen change/ }).className).toMatch(
      /bg-primary/
    );
    fireEvent.click(reject);
    const alert = await screen.findByRole('alert');
    expect(alert.className).toMatch(/dark:bg-rose-950/);
    cleanup();
    const ok = vi.fn(async (_previous: unknown, _form: FormData) => ({
      ok: true as const,
      decision: 'approve' as const,
    }));
    render(<ReviewForm {...base} action={ok} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve frozen change/ }));
    await screen.findByRole('status');
    expect(screen.getByRole('link', { name: 'Back to approvals' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=approvals'
    );
  });
});
