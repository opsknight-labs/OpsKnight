import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthenticationDiagnostics from '@/components/settings/AuthenticationDiagnostics';

const data = {
  registeredSessions: [],
  pendingEmailAlerts: 2,
  failedEmailAlertCount: 1,
  pendingEmailFanoutJobs: 1,
  deliveredEmailAlertCount: 12,
  cancelledEmailAlertCount: 3,
  replicas: [],
  events: [],
};
const firstPage = {
  nextCursor: null,
  alerts: [
    {
      id: 'alert-1',
      title: 'Security alert: provider activation',
      createdAt: '2026-10-13T00:00:00.000Z',
      completedAt: '2026-10-13T00:00:00.000Z',
      eventId: 'event-1',
      recipientId: 'admin',
      attempts: 3,
      lastError: null,
      state: 'FAILED' as const,
      deliveryGeneration: 3,
    },
  ],
};
describe('security delivery diagnostics', () => {
  it('requires explicit confirmation and sends the displayed retry generation', async () => {
    const retry = vi.fn().mockResolvedValue(true);
    render(
      <AuthenticationDiagnostics
        data={data}
        pending={false}
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={retry}
        onLoadHistory={vi.fn().mockResolvedValue(firstPage)}
      />
    );
    expect(screen.getByText('Security email delivery history')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry email' }));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('duplicate');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('alert-1', 3));
  });
  it('disables retry while an administration operation is pending', async () => {
    render(
      <AuthenticationDiagnostics
        data={data}
        pending
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={vi.fn()}
        onLoadHistory={vi.fn().mockResolvedValue(firstPage)}
      />
    );
    expect(await screen.findByRole('button', { name: 'Retry email' })).toBeDisabled();
  });
  it('keeps confirmation open after a rejected operation, then closes it only after success', async () => {
    const retry = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
      <AuthenticationDiagnostics
        data={data}
        pending={false}
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={retry}
        onLoadHistory={vi.fn().mockResolvedValue(firstPage)}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Retry email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Confirm email retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm email retry' })).not.toBeInTheDocument()
    );
  });
  it('loads the next page and resets pagination when the delivery-status filter changes', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ...firstPage, nextCursor: 'next-page' })
      .mockResolvedValueOnce({
        alerts: [{ ...firstPage.alerts[0], id: 'alert-2', title: 'Older security alert' }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({ alerts: [], nextCursor: null });
    render(
      <AuthenticationDiagnostics
        data={data}
        pending={false}
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={vi.fn()}
        onLoadHistory={load}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Load more deliveries' }));
    expect(await screen.findByText('Older security alert')).toBeInTheDocument();
    expect(load).toHaveBeenNthCalledWith(2, 'failed', 'next-page', expect.any(AbortSignal));
    fireEvent.change(screen.getByLabelText('Delivery status'), { target: { value: 'cancelled' } });
    expect(await screen.findByText('No deliveries match this status.')).toBeInTheDocument();
    expect(screen.queryByText('Older security alert')).not.toBeInTheDocument();
  });
});
