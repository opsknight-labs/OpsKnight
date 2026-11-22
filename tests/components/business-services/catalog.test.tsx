import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createFakeBusinessServiceEngine } from '@/lib/business-services/__fixtures__/health';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import CatalogDirectory, { type CatalogRow } from '@/components/business-service/CatalogDirectory';
import {
  catalogHref,
  countMatching,
  parseCatalogParams,
} from '@/components/business-service/catalog-model';

vi.mock('@/app/(app)/services/business/actions', () => ({
  followBusinessServiceAction: vi.fn().mockResolvedValue({ ok: true, id: 'x' }),
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

const actor: AuthorizationActor = { id: 'u1', role: 'USER', status: 'ACTIVE', teamIds: [] };
const payments = { id: 't1', name: 'Payments' };
const since = new Date(Date.now() - 12 * 60_000);
const { engine } = createFakeBusinessServiceEngine({
  services: [
    {
      id: 'checkout',
      name: 'Checkout',
      criticality: 'TIER_0',
      ownerTeam: payments,
      memberCount: 4,
      status: 'MAJOR_OUTAGE',
      health: { since, impactedMemberCount: 2, openIncidentCount: 1 },
    },
    { id: 'billing', name: 'Billing', criticality: 'TIER_1', ownerTeam: payments, memberCount: 2 },
    { id: 'search', name: 'Search', criticality: null, ownerTeam: null, memberCount: 1 },
  ],
});

async function catalogRows(params: Record<string, string | string[]> = {}) {
  const { filter, cursors } = parseCatalogParams(params);
  const page = await engine.listBusinessServices(
    { filter, cursor: cursors.at(-1) ?? null, limit: 2 },
    actor
  );
  const rows: CatalogRow[] = page.items.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    criticality: item.criticality,
    ownerTeam: item.ownerTeam,
    status: item.health.status,
    since: item.health.since,
    memberCount: item.memberCount,
    impactedMemberCount: item.health.impactedMemberCount,
    openIncidentCount: item.health.openIncidentCount,
    followerCount: 3,
    following: false,
  }));
  return { rows, page };
}

const pagination = { page: 1, pageSize: 2, totalCount: 3 };

describe('business-service catalog', () => {
  it('lists health with since, criticality, owner, impacted services and open incidents', async () => {
    const { rows } = await catalogRows();
    render(
      <CatalogDirectory
        rows={rows}
        pagination={pagination}
        filtered={false}
        clearHref="/services/business"
        canManage
      />
    );
    const table = screen.getByRole('table', { name: 'Business services' });
    const checkout = within(table).getByRole('row', { name: /Checkout/ });
    expect(within(checkout).getByText('Major outage')).toBeInTheDocument();
    expect(within(checkout).getByText(/since/)).toBeInTheDocument();
    expect(within(checkout).getByText('Tier 0')).toBeInTheDocument();
    expect(within(checkout).getByText('Payments')).toBeInTheDocument();
    expect(within(checkout).getByText('2 impacted')).toBeInTheDocument();
    expect(within(checkout).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      '/services/business/checkout'
    );
    expect(within(table).getByRole('row', { name: /Billing/ })).toHaveTextContent('Operational');
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 to 2 of 3 entries');
  });

  it('pages with a cursor stack in the URL, so Previous works', async () => {
    const first = await catalogRows();
    expect(first.page.nextCursor).toBe('checkout');
    const next = catalogHref(parseCatalogParams().query, [first.page.nextCursor!]);
    expect(next).toBe('/services/business?c=checkout');
    const second = await catalogRows({ c: ['checkout'] });
    expect(second.rows.map(row => row.name)).toEqual(['Search']);
    expect(catalogHref(parseCatalogParams({ status: 'impacted' }).query, ['a', 'b'])).toBe(
      '/services/business?status=impacted&c=a&c=b'
    );
  });

  it('filters by health, tier and team, and counts matches for the footer', async () => {
    const { query, filter } = parseCatalogParams({ status: 'impacted', tier: 'nope', team: 't1' });
    expect(query.tier).toBe('');
    expect(filter).toEqual({
      status: ['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'],
      ownerTeamId: 't1',
    });
    const page = await engine.listBusinessServices({ filter }, actor);
    expect(page.items.map(item => item.name)).toEqual(['Checkout']);

    const visible = [
      {
        id: 'checkout',
        name: 'Checkout',
        description: null,
        criticality: 'TIER_0' as const,
        ownerTeamId: 't1',
      },
      {
        id: 'billing',
        name: 'Billing',
        description: 'Invoices and refunds',
        criticality: 'TIER_1' as const,
        ownerTeamId: 't1',
      },
      { id: 'search', name: 'Search', description: null, criticality: null, ownerTeamId: null },
    ];
    const health = await engine.getBusinessServiceHealth(['checkout', 'billing', 'search'], actor);
    expect(countMatching(visible, health, query)).toBe(1);
    expect(countMatching(visible, health, parseCatalogParams({ q: 'CHE' }).query)).toBe(1);
    expect(countMatching(visible, health, parseCatalogParams({ tier: 'TIER_1' }).query)).toBe(1);
    // Like the engine, the query also matches the description.
    expect(countMatching(visible, health, parseCatalogParams({ q: 'refund' }).query)).toBe(1);
    expect(countMatching(visible, health, parseCatalogParams().query)).toBe(3);
  });

  it('offers creation from the empty catalog, and Clear filters when filtering found nothing', () => {
    const { rerender } = render(
      <CatalogDirectory
        rows={[]}
        pagination={{ ...pagination, totalCount: 0 }}
        filtered={false}
        clearHref="/services/business"
        canManage
      />
    );
    expect(screen.getByRole('link', { name: /Create a business service/ })).toHaveAttribute(
      'href',
      '/services/business/new'
    );
    rerender(
      <CatalogDirectory
        rows={[]}
        pagination={{ ...pagination, totalCount: 0 }}
        filtered
        clearHref="/services/business"
        canManage={false}
      />
    );
    expect(screen.getByText('No business services match these filters')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/services/business'
    );
    expect(screen.queryByRole('link', { name: /Create a business service/ })).toBeNull();
  });
});
