import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentSlaPolicySettings from '@/components/incident-sla/IncidentSlaPolicySettings';
import { saveIncidentSlaPolicyAction } from '@/app/(app)/settings/incident-sla/actions';

vi.mock('@/app/(app)/settings/incident-sla/actions', () => ({
  saveIncidentSlaPolicyAction: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

describe('IncidentSlaPolicySettings', () => {
  it('shows the effective workspace policy when a service has no override', () => {
    render(
      <IncidentSlaPolicySettings
        scopeKey="service:payments"
        policy={null}
        workspacePolicy={{
          version: 5,
          inheritWorkspace: false,
          baseAckTargetMs: 15 * 60_000,
          baseResolveTargetMs: 120 * 60_000,
          rules: [],
        }}
        canManage={false}
      />
    );

    expect(screen.getByText('Workspace defaults · v5')).toBeInTheDocument();
    expect(screen.getByText('15 minutes')).toBeInTheDocument();
    expect(screen.getByText('120 minutes')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /inherit workspace defaults/i })).toBeChecked();
  });

  it('uses the newly saved version for an immediate second save', async () => {
    const save = vi.mocked(saveIncidentSlaPolicyAction);
    save.mockResolvedValueOnce({ ok: true, version: 3 }).mockResolvedValueOnce({ ok: true, version: 4 });

    render(
      <IncidentSlaPolicySettings
        scopeKey="workspace"
        policy={{
          version: 2,
          inheritWorkspace: false,
          baseAckTargetMs: 15 * 60_000,
          baseResolveTargetMs: 120 * 60_000,
          rules: [],
        }}
        canManage
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save sla policy/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual(expect.objectContaining({ expectedVersion: 2 }));

    const saveAgain = await screen.findByRole('button', { name: /save sla policy/i });
    fireEvent.click(saveAgain);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
  });
});
