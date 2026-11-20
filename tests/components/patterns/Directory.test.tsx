import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryHeader, DirectoryTable, useDirectoryView } from '@/components/patterns/Directory';

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bo' },
];

describe('Directory pattern', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the table view and remembers the choice per page', () => {
    const { result } = renderHook(() => useDirectoryView('users'));
    expect(result.current[0]).toBe('table');
    act(() => result.current[1]('cards'));
    expect(result.current[0]).toBe('cards');
    expect(window.localStorage.getItem('opsknight:directory-view:users')).toBe('cards');
    expect(renderHook(() => useDirectoryView('teams')).result.current[0]).toBe('table');
  });

  it('renders named columns, row selection and actions', () => {
    const onToggle = vi.fn();
    render(
      <DirectoryTable
        label="Users"
        rows={rows}
        getRowId={r => r.id}
        columns={[{ id: 'name', header: 'Name', cell: r => r.name }]}
        selection={{ selected: new Set(['a']), onToggle, rowLabel: r => `Select ${r.name}` }}
        rowActions={r => <button type="button">Menu {r.name}</button>}
        mobileRow={r => r.name}
      />
    );
    expect(screen.getByRole('table', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox', { name: 'Select Bo' });
    fireEvent.click(boxes[boxes.length - 1]);
    expect(onToggle).toHaveBeenCalledWith('b', true);
  });

  it('shows the empty state instead of an empty table', () => {
    render(
      <DirectoryTable
        label="Users"
        rows={[]}
        getRowId={(r: Row) => r.id}
        columns={[]}
        mobileRow={(r: Row) => r.name}
        empty={<p>No users</p>}
      />
    );
    expect(screen.getByText('No users')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('header view toggle reports pressed state', () => {
    const onChange = vi.fn();
    render(<DirectoryHeader title="Users" view={{ value: 'table', onChange }} />);
    expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(onChange).toHaveBeenCalledWith('cards');
  });
});
