import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DirectoryGuide,
  DirectoryGuideSteps,
  DirectoryHeader,
  DirectoryTable,
  useDirectoryView,
} from '@/components/patterns/Directory';

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

  const steps = [
    { title: 'First', description: 'Do the first thing.' },
    { title: 'Second', description: 'Then the second.' },
  ];
  const links = [
    { label: 'Escalation Policies', href: '/policies' },
    { label: 'Team Directory', href: '/teams' },
  ];

  it('guide shows quick links and opens a named popover with steps and links', () => {
    render(<DirectoryGuide title="How things work" steps={steps} links={links} />);
    expect(screen.getByRole('link', { name: 'Escalation Policies' }).getAttribute('href')).toBe(
      '/policies'
    );
    expect(screen.queryByText('Do the first thing.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'How things work' }));
    const popover = screen.getByRole('dialog', { name: 'How things work' });
    const items = within(popover).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual([
      '1FirstDo the first thing.',
      '2SecondThen the second.',
    ]);
    expect(
      within(popover)
        .getByRole('link', { name: /Team Directory/ })
        .getAttribute('href')
    ).toBe('/teams');

    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('guide steps render on their own for empty states', () => {
    render(<DirectoryGuideSteps steps={steps} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('header renders the guide before the view toggle', () => {
    render(
      <DirectoryHeader
        title="Things"
        view={{ value: 'table', onChange: vi.fn() }}
        guide={<DirectoryGuide title="How things work" steps={steps} />}
      />
    );
    const guide = screen.getByRole('button', { name: 'How things work' });
    const toggle = screen.getByRole('group', { name: 'Directory view' });
    expect(guide.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
