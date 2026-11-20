import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DirectoryGuide,
  DirectoryGuideSteps,
  DirectoryHeader,
  DirectoryTable,
  useDirectoryColumns,
  useDirectoryDensity,
  useDirectoryView,
  type DirectoryColumn,
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

  describe('power-user features', () => {
    const people: Row[] = [
      { id: 'b', name: 'Bo' },
      { id: 'a', name: 'Ada' },
      { id: 'c', name: 'Cy' },
    ];
    const cols: DirectoryColumn<Row>[] = [
      {
        id: 'name',
        header: 'Name',
        sortKey: 'name',
        sortValue: r => r.name,
        cell: r => <a href={`/u/${r.id}`}>{r.name}</a>,
      },
      { id: 'email', header: 'Email', hideable: true, cell: r => `${r.id}@x.io` },
    ];
    const bodyNames = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map(r => r.textContent);

    it('remembers density across every directory', () => {
      const { result } = renderHook(() => useDirectoryDensity());
      expect(result.current[0]).toBe('comfortable');
      render(<DirectoryHeader title="Users" density />);
      fireEvent.click(screen.getByRole('button', { name: 'Compact rows' }));
      expect(result.current[0]).toBe('compact');
      expect(window.localStorage.getItem('opsknight:directory-density')).toBe('compact');
      expect(
        screen.getByRole('button', { name: 'Compact rows' }).getAttribute('aria-pressed')
      ).toBe('true');
    });

    it('persists hidden columns per directory and does not render them', () => {
      const { result } = renderHook(() => useDirectoryColumns('people', cols));
      act(() => result.current.onToggle('email', false));
      expect(window.localStorage.getItem('opsknight:directory-columns:people')).toBe('email');
      expect(renderHook(() => useDirectoryColumns('other', cols)).result.current.hidden.size).toBe(
        0
      );
      render(
        <DirectoryTable
          label="People"
          rows={people}
          getRowId={r => r.id}
          columns={cols}
          hiddenColumns={result.current.hidden}
          mobileRow={r => r.name}
        />
      );
      expect(screen.queryByRole('columnheader', { name: 'Email' })).toBeNull();
      expect(screen.queryByText('a@x.io')).toBeNull();
    });

    it('never hides the primary column, even if marked hideable', () => {
      render(
        <DirectoryTable
          label="People"
          rows={people}
          getRowId={r => r.id}
          columns={[{ ...cols[0], hideable: true }, cols[1]]}
          hiddenColumns={new Set(['name', 'email'])}
          mobileRow={r => r.name}
        />
      );
      expect(screen.getByRole('columnheader', { name: /Name/ })).toBeTruthy();
    });

    it('cycles aria-sort and sorts client-side without onSortChange', () => {
      render(
        <DirectoryTable
          label="People"
          rows={people}
          getRowId={r => r.id}
          columns={cols}
          mobileRow={r => r.name}
        />
      );
      const header = screen.getByRole('columnheader', { name: /Name/ });
      expect(header.getAttribute('aria-sort')).toBeNull();
      fireEvent.click(within(header).getByRole('button'));
      expect(header.getAttribute('aria-sort')).toBe('ascending');
      expect(bodyNames()[0]).toContain('Ada');
      fireEvent.click(within(header).getByRole('button'));
      expect(header.getAttribute('aria-sort')).toBe('descending');
      expect(bodyNames()[0]).toContain('Cy');
    });

    it('hands sorting to onSortChange and leaves row order alone', () => {
      const onSortChange = vi.fn();
      render(
        <DirectoryTable
          label="People"
          rows={people}
          getRowId={r => r.id}
          columns={cols}
          sort={{ key: 'name', direction: 'asc' }}
          onSortChange={onSortChange}
          mobileRow={r => r.name}
        />
      );
      const header = screen.getByRole('columnheader', { name: /Name/ });
      expect(header.getAttribute('aria-sort')).toBe('ascending');
      expect(bodyNames()[0]).toContain('Bo');
      fireEvent.click(within(header).getByRole('button'));
      expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
    });

    it('moves row focus with j/k and arrows, toggles with x, opens with Enter', () => {
      const onToggle = vi.fn();
      const onOpen = vi.fn((e: Event) => e.preventDefault());
      render(
        <>
          <input aria-label="Search" />
          <DirectoryTable
            label="People"
            rows={people}
            getRowId={r => r.id}
            columns={cols}
            selection={{ selected: new Set(), onToggle, rowLabel: r => `Select ${r.name}` }}
            mobileRow={r => r.name}
          />
        </>
      );
      const [first, second, third] = screen.getAllByRole('row').slice(1);
      expect(first.tabIndex).toBe(0);
      expect(second.tabIndex).toBe(-1);
      first.focus();
      fireEvent.keyDown(first, { key: 'j' });
      expect(document.activeElement).toBe(second);
      fireEvent.keyDown(second, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(third);
      fireEvent.keyDown(third, { key: 'k' });
      expect(document.activeElement).toBe(second);
      expect(second.tabIndex).toBe(0);

      fireEvent.keyDown(second, { key: 'x' });
      expect(onToggle).toHaveBeenCalledWith('a', true);

      within(second).getByRole('link').addEventListener('click', onOpen);
      fireEvent.keyDown(second, { key: 'Enter' });
      expect(onOpen).toHaveBeenCalled();

      // Typing elsewhere is never intercepted.
      const search = screen.getByRole('textbox', { name: 'Search' });
      search.focus();
      fireEvent.keyDown(search, { key: 'j' });
      expect(document.activeElement).toBe(search);
    });

    it('columns menu lists only hideable, non-primary columns', () => {
      const { result } = renderHook(() => useDirectoryColumns('menu', cols));
      render(<DirectoryHeader title="People" columns={result.current} />);
      const trigger = screen.getByRole('button', { name: /Columns/ });
      fireEvent.keyDown(trigger, { key: 'Enter' });
      const items = screen.getAllByRole('menuitemcheckbox');
      expect(items.map(i => i.textContent)).toEqual(['Email']);
      expect(items[0].getAttribute('aria-checked')).toBe('true');
      fireEvent.click(items[0]);
      expect(window.localStorage.getItem('opsknight:directory-columns:menu')).toBe('email');
    });
  });
});
