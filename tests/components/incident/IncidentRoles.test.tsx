import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentRoles, { type IncidentRoleSlot } from '@/components/incident/detail/IncidentRoles';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/toast', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const ada = { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' };
const slot = (overrides: Partial<IncidentRoleSlot>): IncidentRoleSlot => ({
  roleKey: 'COMMANDER',
  label: 'Incident commander',
  shortLabel: 'Commander',
  description: 'Owns the response.',
  holder: null,
  canAssignOthers: false,
  canTakeSelf: false,
  canClear: false,
  ...overrides,
});

describe('IncidentRoles', () => {
  it('shows holders and read-only gaps without controls for viewers', () => {
    render(
      <IncidentRoles
        roles={[
          slot({ holder: ada }),
          slot({ roleKey: 'SCRIBE', label: 'Scribe', shortLabel: 'Scribe' }),
        ]}
        users={[]}
        currentUserId="viewer"
        onSetRole={vi.fn()}
        showAllRoles
      />
    );
    expect(screen.getByRole('region', { name: 'Incident roles' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('folds empty non-commander roles behind one chip and opens them on click', () => {
    render(
      <IncidentRoles
        roles={[
          slot({ canTakeSelf: true }),
          slot({ roleKey: 'OPS_LEAD', label: 'Operations lead', shortLabel: 'Ops lead', canAssignOthers: true }),
          slot({ roleKey: 'SCRIBE', label: 'Scribe', shortLabel: 'Scribe', canAssignOthers: true }),
        ]}
        users={[]}
        currentUserId="u-me"
        onSetRole={vi.fn()}
      />
    );
    expect(screen.getByText('Commander')).toBeInTheDocument();
    expect(screen.queryByText('Ops lead')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show more roles: Operations lead, Scribe/ }));
    expect(screen.getByText('Ops lead')).toBeInTheDocument();
    expect(screen.getByText('Scribe')).toBeInTheDocument();
  });

  it('keeps a held role visible and hides the fold chip from read-only viewers', () => {
    render(
      <IncidentRoles
        roles={[
          slot({}),
          slot({ roleKey: 'SCRIBE', label: 'Scribe', shortLabel: 'Scribe', holder: ada }),
          slot({ roleKey: 'OPS_LEAD', label: 'Operations lead', shortLabel: 'Ops lead' }),
        ]}
        users={[]}
        currentUserId="viewer"
        onSetRole={vi.fn()}
      />
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Ops lead')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show more roles/ })).not.toBeInTheDocument();
  });

  it('lets an operator take command from the empty slot', async () => {
    const onSetRole = vi.fn().mockResolvedValue({ changed: true });
    render(
      <IncidentRoles
        roles={[slot({ canTakeSelf: true })]}
        users={[]}
        currentUserId="u-me"
        onSetRole={onSetRole}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Incident commander: unassigned. Change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take command' }));
    await waitFor(() => expect(onSetRole).toHaveBeenCalledWith('COMMANDER', 'u-me'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('lets the holder step down', async () => {
    const onSetRole = vi.fn().mockResolvedValue({ changed: true });
    render(
      <IncidentRoles
        roles={[slot({ holder: { ...ada, id: 'u-me' }, canTakeSelf: true, canClear: true })]}
        users={[]}
        currentUserId="u-me"
        onSetRole={onSetRole}
      />
    );
    expect(screen.getByText('Ada Lovelace (you)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Incident commander: Ada Lovelace/ }));
    expect(screen.queryByRole('button', { name: 'Take command' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Step down' }));
    await waitFor(() => expect(onSetRole).toHaveBeenCalledWith('COMMANDER', null));
  });
});
