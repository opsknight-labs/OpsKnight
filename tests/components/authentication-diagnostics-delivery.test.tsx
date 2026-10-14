import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthenticationDiagnostics from '@/components/settings/AuthenticationDiagnostics';

const data = {
  registeredSessions: [],
  pendingEmailAlerts: 2,
  failedEmailAlertCount: 1,
  failedEmailAlerts: [
    {
      id: 'alert-1',
      title: 'Security alert: provider activation',
      failedAt: '2026-10-13T00:00:00.000Z',
      deliveryGeneration: 3,
    },
  ],
  replicas: [],
  events: [],
};
describe('security delivery diagnostics', () => {
  it('requires explicit confirmation and sends the displayed retry generation', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthenticationDiagnostics
        data={data}
        pending={false}
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={retry}
      />
    );
    expect(screen.getByText('Failed security email deliveries (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry email' }));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('duplicate');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('alert-1', 3));
  });
  it('disables retry while an administration operation is pending', () => {
    render(
      <AuthenticationDiagnostics
        data={data}
        pending
        onRefresh={vi.fn()}
        onRevoke={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Retry email' })).toBeDisabled();
  });
});
