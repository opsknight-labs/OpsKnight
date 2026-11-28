// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ save: vi.fn(), search: vi.fn() }));
vi.mock('@/app/(app)/services/actions', () => ({
  updateServiceWarRoomAutoAdd: h.save,
  searchWarRoomAutoAddPeople: h.search,
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import WarRoomAutoAddCard from '@/components/service/WarRoomAutoAddCard';

const people = [
  { id: 'u1', name: 'Ana', email: 'ana@x.io' },
  { id: 'u2', name: 'Bob', email: 'bob@x.io' },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.search.mockResolvedValue(people);
  h.save.mockResolvedValue({ success: true, error: null });
});

describe('WarRoomAutoAddCard', () => {
  it('sends the team option and chosen people, and keeps showing them after saving', async () => {
    render(
      <WarRoomAutoAddCard
        serviceId="s1"
        teamName="Platform"
        initialTeam="NONE"
        initialUserIds={[]}
        people={people}
        canManage
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MANAGERS' } });
    fireEvent.click(screen.getByLabelText(/Ana/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    const data = h.save.mock.calls[0][1] as FormData;
    expect(data.get('serviceId')).toBe('s1');
    expect(data.get('warRoomAutoAddTeam')).toBe('MANAGERS');
    expect(data.getAll('userIds')).toEqual(['u1']);
    // The fields are not blanked by a form reset.
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('MANAGERS');
    expect((screen.getByLabelText(/Ana/) as HTMLInputElement).checked).toBe(true);
  });

  it('is read-only without permission and offers no save button', () => {
    render(
      <WarRoomAutoAddCard
        serviceId="s1"
        teamName={null}
        initialTeam="NONE"
        initialUserIds={['u2']}
        people={people}
        canManage={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/no team/i)).toBeTruthy();
    expect((screen.getByLabelText(/Bob/) as HTMLInputElement).checked).toBe(true);
  });

  it('drops anyone the server refused, showing exactly what was saved', async () => {
    h.save.mockResolvedValue({ success: true, error: null, userIds: ['u2'] });
    render(
      <WarRoomAutoAddCard
        serviceId="s1"
        teamName="Platform"
        initialTeam="NONE"
        initialUserIds={['u1', 'u2']}
        people={people}
        canManage
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Ana/) as HTMLInputElement).checked).toBe(false)
    );
    expect((screen.getByLabelText(/Bob/) as HTMLInputElement).checked).toBe(true);
  });
});
