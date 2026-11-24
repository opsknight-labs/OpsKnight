import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const bulkEditAction = vi.fn();
vi.mock('@/app/(app)/services/business/phase5b-actions', () => ({
  bulkEditAction: (...args: unknown[]) => bulkEditAction(...args),
}));
vi.mock('@/app/(app)/services/business/actions', () => ({
  followBusinessServiceAction: vi.fn().mockResolvedValue({ ok: true, id: 'x' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

import BulkEditBar from '@/components/business-service/BulkEditBar';
import CatalogDirectory, { type CatalogRow } from '@/components/business-service/CatalogDirectory';

beforeEach(() => bulkEditAction.mockReset());

const row = (id: string, name: string): CatalogRow => ({
  id,
  name,
  description: null,
  criticality: null,
  ownerTeam: null,
  status: 'OPERATIONAL',
  since: null,
  memberCount: 1,
  impactedMemberCount: 0,
  openIncidentCount: 0,
  followerCount: 0,
  following: false,
  hygiene: id === 'a' ? ['REVIEW_OVERDUE'] : [],
});

describe('BulkEditBar', () => {
  it('asks for a change before calling the server', () => {
    render(<BulkEditBar ids={['a', 'b']} names={new Map()} teams={[]} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least one change/);
    expect(bulkEditAction).not.toHaveBeenCalled();
  });

  it('previews with dryRun and lists per-item failures', async () => {
    bulkEditAction.mockResolvedValue({
      ok: true,
      dryRun: true,
      summary: { ok: 1, failed: 1 },
      results: [
        { id: 'a', ok: true, changed: ['tags'] },
        { id: 'b', ok: false, error: 'Business service not found.' },
      ],
    });
    render(
      <BulkEditBar
        ids={['a', 'b']}
        names={new Map([['a', 'Checkout']])}
        teams={[]}
        onClear={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('Add tags'), { target: { value: 'pci, api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(bulkEditAction).toHaveBeenCalledWith({
      ids: ['a', 'b'],
      changes: { addTags: ['pci', 'api'] },
      dryRun: true,
    });
    expect(screen.getByRole('status').textContent).toMatch(/1 ok, 1 failed/);
    expect(screen.getByText(/Business service not found/)).toBeTruthy();
    expect(screen.getByText('Checkout')).toBeTruthy();
  });
});

describe('CatalogDirectory selection and hygiene', () => {
  it('shows hygiene badges and the bulk bar once a row is selected (managers only)', () => {
    const rows = [row('a', 'Checkout'), row('b', 'Billing')];
    const props = {
      rows,
      filtered: false,
      clearHref: '/services/business',
      pagination: { page: 1, pageSize: 25, totalCount: 2 },
    };
    const { unmount } = render(<CatalogDirectory {...props} canManage={false} />);
    expect(screen.getAllByText('Review overdue').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    unmount();

    render(<CatalogDirectory {...props} canManage />);
    expect(screen.queryByRole('region', { name: 'Bulk edit' })).toBeNull();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Checkout' })[0]);
    expect(screen.getByRole('region', { name: 'Bulk edit' }).textContent).toMatch(/1 selected/);
  });
});
