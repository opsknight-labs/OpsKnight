import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatusPageBusinessLayout from '@/components/status-page/StatusPageBusinessLayout';

const businessServices = [
  { id: 'checkout', name: 'Checkout', memberServiceIds: ['api', 'db', 'cdn'] },
  { id: 'payments', name: 'Payments', memberServiceIds: ['api'], parentIds: ['checkout'] },
  { id: 'search', name: 'Search', memberServiceIds: [] },
  { id: 'mail', name: 'Mail', memberServiceIds: [] },
];
// cdn is not on the page; db is on the page but hidden; db comes before api in page order.
const members = {
  db: { name: 'Database', shown: false, position: 0 },
  api: { name: 'API', shown: true, position: 1 },
};

function renderLayout(over: Partial<React.ComponentProps<typeof StatusPageBusinessLayout>> = {}) {
  const props = {
    layout: 'BUSINESS_EXPANDABLE' as const,
    onLayoutChange: vi.fn(),
    businessServices,
    selectedIds: ['checkout', 'payments'],
    onSelectedIdsChange: vi.fn(),
    onConfigChange: vi.fn(),
    onOverride: vi.fn(),
    overrides: { checkout: { status: null, until: null } },
    members,
    onMemberShownChange: vi.fn(),
    onMembersReorder: vi.fn(),
    onExpandGroupsByDefaultChange: vi.fn(),
    ...over,
  };
  render(<StatusPageBusinessLayout {...props} />);
  return props;
}

describe('StatusPageBusinessLayout tree editor', () => {
  it('names the members-hidden layout plainly and moves through layouts with arrow keys', () => {
    const props = renderLayout();
    const radios = screen.getAllByRole('radio');
    expect(radios.map(radio => radio.tabIndex)).toEqual([-1, -1, 0]);
    expect(
      screen.getByRole('radio', { name: /Business services only \(services hidden\)/ })
    ).toBeInTheDocument();
    fireEvent.keyDown(radios[2], { key: 'ArrowRight' });
    expect(props.onLayoutChange).toHaveBeenCalledWith('FLAT');
    fireEvent.keyDown(radios[2], { key: 'ArrowLeft' });
    expect(props.onLayoutChange).toHaveBeenLastCalledWith('BUSINESS');
  });

  it('nests on-page members under their group in page order with shown counts', () => {
    renderLayout();
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Services in Checkout' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Database', 'API']);
  });

  it('reorders and hides members of a group', () => {
    const props = renderLayout();
    const list = screen.getByRole('list', { name: 'Services in Checkout' });
    fireEvent.click(within(list).getByRole('button', { name: 'Move API up' }));
    expect(props.onMembersReorder).toHaveBeenCalledWith('checkout', ['api', 'db']);
    fireEvent.click(within(list).getByRole('switch', { name: 'Show Database on this page' }));
    expect(props.onMemberShownChange).toHaveBeenCalledWith('db', true);
  });

  it('indents a child business service under the one it supports', () => {
    renderLayout();
    const payments = screen
      .getAllByRole('listitem')
      .find(item => item.textContent?.includes('Payments') && item.className.includes('pl-8'));
    expect(payments).toBeDefined();
  });

  it('uses switches, explains overrides need a save, and toggles expanded groups', () => {
    const props = renderLayout();
    expect(screen.getAllByRole('switch', { name: 'Show on page' }).length).toBe(2);
    expect(
      screen.getByText('Save the page to set a status override for Payments.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Expand groups by default/ }));
    expect(props.onExpandGroupsByDefaultChange).toHaveBeenCalledWith(true);
  });

  it('filters the business services that can be added', () => {
    renderLayout();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a business service to add' }), {
      target: { value: 'sea' },
    });
    expect(screen.getByRole('button', { name: '+ Search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Mail' })).not.toBeInTheDocument();
  });
});
