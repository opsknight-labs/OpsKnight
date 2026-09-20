import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentClassificationSettings from '@/components/incident-sla/IncidentClassificationSettings';
import { saveWorkspaceClassificationPolicyAction } from '@/app/(app)/settings/incident-sla/actions';

vi.mock('@/app/(app)/settings/incident-sla/actions', () => ({
  saveWorkspaceClassificationPolicyAction: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

const rules = [
  { matchValue: 'critical' as const, priority: null, urgency: 'HIGH' as const },
  { matchValue: 'error' as const, priority: null, urgency: 'MEDIUM' as const },
  { matchValue: 'warning' as const, priority: null, urgency: 'MEDIUM' as const },
  { matchValue: 'info' as const, priority: null, urgency: 'LOW' as const },
];

describe('IncidentClassificationSettings', () => {
  it('keeps automatic priority opt-in and advances optimistic version after save', async () => {
    const save = vi.mocked(saveWorkspaceClassificationPolicyAction);
    save
      .mockResolvedValueOnce({ ok: true, version: 2 })
      .mockResolvedValueOnce({ ok: true, version: 3 });

    render(
      <IncidentClassificationSettings
        policy={{ version: 1, derivePriorityFromUrgency: false, rules }}
      />
    );

    expect(screen.getAllByText('No automatic priority')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: /save classification policy/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        expectedVersion: 1,
        rules: expect.arrayContaining([
          expect.objectContaining({ matchValue: 'critical', priority: null, urgency: 'HIGH' }),
        ]),
      })
    );

    const saveAgain = await screen.findByRole(
      'button',
      { name: /save classification policy/i },
      { timeout: 5000 }
    );
    fireEvent.click(saveAgain);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(expect.objectContaining({ expectedVersion: 2 }));
  });
});
