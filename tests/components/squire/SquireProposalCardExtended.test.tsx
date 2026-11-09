import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
const now = new Date('2026-11-08T08:00:00Z');
const card = (extra: Partial<SquireProposalView> = {}): SquireProposalView => ({
  token: 'sealed-1',
  action: 'escalate_incident',
  kind: 'WRITE',
  title: 'Escalate now',
  detail: 'Page escalation level 2 of 3 for “Checkout errors” now.',
  incidentId: 'incident-1',
  expiresAt: new Date(now.getTime() + 600_000).toISOString(),
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

describe('extended proposal cards', () => {
  it('shows the server preview, the impact and a specific confirm label', () => {
    render(
      <SquireProposalCard
        proposal={card({
          preview: [
            { label: 'Policy', value: 'Payments escalation' },
            { label: 'Pages', value: 'on-call schedule “Primary”' },
          ],
          confirmLabel: 'Escalate',
          impact: 'PAGES_PEOPLE',
        })}
      />
    );
    const preview = screen.getByLabelText('What will happen');
    expect(within(preview).getByText('Pages')).toBeInTheDocument();
    expect(within(preview).getByText('on-call schedule “Primary”')).toBeInTheDocument();
    expect(screen.getByText('This notifies people right away.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it.each([
    ['EXTERNAL_SYSTEM', 'This sends incident details to another system.'],
    ['PUBLIC', 'This is visible to anyone who can see the status page.'],
    ['AUTOMATION', 'This starts automation. Its own approval steps still apply.'],
  ] as const)('explains the %s impact', (impact, text) => {
    render(<SquireProposalCard proposal={card({ impact })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders preview values as text, never as markup', () => {
    const { container } = render(
      <SquireProposalCard
        proposal={card({ preview: [{ label: 'Message', value: '<img src=x onerror=alert(1)>' }] })}
      />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('runs a two-step status update: the draft confirmation offers publishing as its own card', async () => {
    const publish = card({
      token: 'sealed-2',
      action: 'publish_status_update',
      title: 'Publish the status update',
      detail: 'Publish “Checkout degraded” on “Public status” now.',
      confirmLabel: 'Publish',
      impact: 'PUBLIC',
      step: 'Step 2 of 2',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        message: 'Draft saved on the status page. Review it below and confirm to publish.',
        followUp: publish,
      }),
    });
    render(
      <SquireProposalCard
        proposal={card({
          action: 'draft_status_update',
          title: 'Draft a status update',
          detail: 'Create an unpublished draft.',
          confirmLabel: 'Create draft',
          step: 'Step 1 of 2',
        })}
      />
    );
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'sealed-1' });
    // Publishing has not happened: it waits for its own confirmation.
    const second = screen.getByRole('group', {
      name: 'Suggested action: Publish the status update',
    });
    expect(within(second).getByText(/Step 2 of 2/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, message: 'Status update published.' }),
    });
    await act(async () => {
      fireEvent.click(within(second).getByRole('button', { name: 'Publish' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: 'sealed-2' });
    expect(within(second).getByRole('status')).toHaveTextContent('Status update published.');
  });

  it('dismissing the publish step leaves the draft unpublished', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        message: 'Draft saved.',
        followUp: card({
          token: 'sealed-2',
          title: 'Publish the status update',
          confirmLabel: 'Publish',
        }),
      }),
    });
    render(<SquireProposalCard proposal={card({ confirmLabel: 'Create draft' })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    });
    const second = screen.getByRole('group', {
      name: 'Suggested action: Publish the status update',
    });
    fireEvent.click(within(second).getByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByRole('group', { name: 'Suggested action: Publish the status update' })
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restores the publish step from a recovered draft outcome', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          outcome: {
            status: 'SUCCEEDED',
            message: 'Draft saved.',
            result: {
              followUp: card({
                token: 'sealed-2',
                title: 'Publish the status update',
                confirmLabel: 'Publish',
              }),
            },
          },
        },
      }),
    });
    render(<SquireProposalCard proposal={card({ receiptId: 'receipt-1' })} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole('group', { name: 'Suggested action: Publish the status update' })
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});
