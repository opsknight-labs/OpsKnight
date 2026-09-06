import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ResponderCombobox from '@/components/ResponderCombobox';

vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span aria-hidden="true">{name.slice(0, 1)}</span>,
}));

const responders = [
  {
    id: 'user-alex',
    name: 'Alex Vance',
    email: 'alex@example.com',
    role: 'RESPONDER',
  },
  {
    id: 'user-taylor',
    name: 'Taylor Reed',
    email: 'taylor@example.com',
    role: 'ADMIN',
  },
];

describe('ResponderCombobox', () => {
  it('shows a disabled, explanatory state when every active responder is assigned', () => {
    render(<ResponderCombobox users={[]} onSelect={vi.fn()} />);

    const trigger = screen.getByRole('combobox', {
      name: 'All active responders are already assigned',
    });
    expect(trigger).toHaveProperty('disabled', true);
    expect(screen.getByText('All Assigned')).toBeDefined();
  });

  it('opens a searchable responder picker with identity context', () => {
    render(<ResponderCombobox users={responders} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Add responder' }));

    expect(screen.getByLabelText('Search available responders')).toBeDefined();
    expect(screen.getByText('Alex Vance')).toBeDefined();
    expect(screen.getByText('alex@example.com')).toBeDefined();
    expect(screen.getByText('Taylor Reed')).toBeDefined();
  });

  it('returns the stable user id when a responder is selected', () => {
    const onSelect = vi.fn();
    render(<ResponderCombobox users={responders} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Add responder' }));
    fireEvent.click(screen.getByText('Alex Vance'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('user-alex');
  });
});
