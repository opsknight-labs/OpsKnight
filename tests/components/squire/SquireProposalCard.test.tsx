import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SquireProposalCard, {
  type SquireProposalView,
} from '@/components/squire/SquireProposalCard';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const fetchMock = vi.fn();
const now = new Date('2026-11-03T08:00:00Z');
const proposal = (extra: Partial<SquireProposalView> = {}): SquireProposalView => ({
  token: 'sealed',
  action: 'acknowledge_incident',
  kind: 'WRITE',
  title: 'Acknowledge incident',
  detail: 'Acknowledge database outage.',
  incidentId: 'incident-1',
  expiresAt: new Date(now.getTime() + 2_000).toISOString(),
  ...extra,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Squire proposal review', () => {
  it('shows the deadline and links to the affected incident', () => {
    const { container } = render(<SquireProposalCard proposal={proposal()} />);
    expect(container.querySelector('time')).toHaveAttribute('datetime', proposal().expiresAt);
    expect(screen.getByRole('link', { name: 'View incident' })).toHaveAttribute(
      'href',
      '/incidents/incident-1'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expires while open and cannot submit the old suggestion', () => {
    render(<SquireProposalCard proposal={proposal()} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status')).toHaveTextContent(/expired/);
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('checks the clock again on confirmation even before the expiry timer runs', () => {
    render(<SquireProposalCard proposal={proposal()} />);
    vi.setSystemTime(new Date(now.getTime() + 3_000));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/expired/);
  });

  it('does not mask the result of a confirmed action that completes after expiry', async () => {
    let finish!: (response: unknown) => void;
    fetchMock.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    render(<SquireProposalCard proposal={proposal()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await act(async () =>
      finish({ ok: true, json: async () => ({ ok: true, message: 'Incident acknowledged.' }) })
    );
    expect(screen.getByRole('status')).toHaveTextContent('Incident acknowledged.');
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an invalid expiry without making a request', () => {
    render(<SquireProposalCard proposal={proposal({ expiresAt: 'invalid' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/expired/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps native review links available without executing an expired navigation suggestion', () => {
    render(
      <SquireProposalCard
        proposal={proposal({
          kind: 'NAVIGATE',
          href: '/runbooks/rb-1',
          expiresAt: now.toISOString(),
        })}
      />
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/runbooks/rb-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
