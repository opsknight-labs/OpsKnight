import { describe, expect, it } from 'vitest';
import { compareKeys, derivedSortKey } from '@/lib/business-services/stats';
import {
  catalogSort,
  parseCatalogParams,
  toListSort,
} from '@/components/business-service/catalog-model';

type Row = Parameters<typeof derivedSortKey>[0];
const row = (id: string, name: string, extra: Partial<Row> = {}): Row => ({
  id,
  name,
  criticality: null,
  ownerTeam: null,
  ...extra,
});
const facts = (
  status: 'OPERATIONAL' | 'DEGRADED' | 'MAJOR_OUTAGE',
  openIncidents = 0,
  budgetLeft: number | null = null
) => ({
  status,
  openIncidents,
  budgetLeft,
});

describe('catalog derived sort', () => {
  const rows = [
    { row: row('a', 'Alpha', { criticality: 'TIER_2' }), facts: facts('OPERATIONAL', 0, 90) },
    { row: row('b', 'Beta', { criticality: 'TIER_0' }), facts: facts('DEGRADED', 2, 10) },
    { row: row('c', 'Gamma', { criticality: 'TIER_1' }), facts: facts('MAJOR_OUTAGE', 1) },
    { row: row('d', 'Delta'), facts: facts('DEGRADED', 5, 50) },
  ];
  const order = (sort: Parameters<typeof derivedSortKey>[1], direction: 'asc' | 'desc') =>
    rows
      .map(entry => ({
        id: entry.row.id,
        key: derivedSortKey(entry.row, sort, direction, entry.facts),
      }))
      .sort((x, y) => compareKeys(x.key, y.key))
      .map(entry => entry.id);

  it('defaults to worst first, then tier (no tier last), then name', () => {
    expect(order('health', 'desc')).toEqual(['c', 'b', 'd', 'a']);
  });

  it('sorts by tier with untiered services last in both directions', () => {
    expect(order('tier', 'asc')).toEqual(['b', 'c', 'a', 'd']);
    expect(order('tier', 'desc')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('sorts by open incidents and by budget left, services without an SLO last', () => {
    expect(order('incidents', 'desc')).toEqual(['d', 'b', 'c', 'a']);
    expect(order('budget', 'asc')).toEqual(['b', 'd', 'a', 'c']);
    expect(order('budget', 'desc')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('sorts names descending, a longer name before its own prefix', () => {
    const named = [row('1', 'ab'), row('2', 'abc'), row('3', 'b')];
    const keys = named.map(r => ({
      id: r.id,
      key: derivedSortKey(r, 'name', 'desc', facts('OPERATIONAL')),
    }));
    expect(keys.sort((x, y) => compareKeys(x.key, y.key)).map(k => k.id)).toEqual(['3', '2', '1']);
  });
});

describe('catalog sort param', () => {
  it('keeps the default out of the URL and rejects unknown keys', () => {
    expect(parseCatalogParams({ sort: 'health_desc' }).query.sort).toBe('');
    expect(parseCatalogParams({ sort: 'bogus_asc' }).query.sort).toBe('');
    expect(parseCatalogParams({ sort: 'budget_asc' }).query.sort).toBe('budget_asc');
    expect(catalogSort('')).toEqual({ key: 'health', direction: 'desc' });
  });

  it('maps name ascending to the keyset order and everything else to a derived sort', () => {
    expect(toListSort('name_asc')).toEqual({ sort: 'name' });
    expect(toListSort('name_desc')).toEqual({ sort: 'name', direction: 'desc' });
    expect(toListSort('')).toEqual({ sort: 'health', direction: 'desc' });
    expect(toListSort('owner_asc')).toEqual({ sort: 'owner', direction: 'asc' });
  });

  it('carries a valid attribute filter into the list filter', () => {
    const { query, filter } = parseCatalogParams({ attr: 'pci=true' });
    expect(query.attr).toBe('pci=true');
    expect(filter.attribute).toEqual({ key: 'pci', value: 'true' });
    expect(parseCatalogParams({ attr: 'nope' }).query.attr).toBe('');
  });
});
