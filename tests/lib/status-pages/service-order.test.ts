import { describe, expect, it } from 'vitest';
import { orderedServiceIds, reorderGroupMembers } from '@/lib/status-pages/service-order';

describe('page service order', () => {
  it('sorts by order and keeps ties in their given sequence', () => {
    const order = new Map([
      ['a', 20],
      ['b', 0],
      ['c', 10],
      ['d', 0],
    ]);
    expect(orderedServiceIds(['a', 'b', 'c', 'd'], id => order.get(id))).toEqual([
      'b',
      'd',
      'c',
      'a',
    ]);
  });

  it('reorders a group inside the slots its members hold, leaving other services in place', () => {
    // x and y are outside the group; the group's members a, b, c sit at slots 0, 2, 4.
    const page = ['a', 'x', 'b', 'y', 'c'];
    expect(reorderGroupMembers(page, ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'y', 'b']);
  });

  it('ignores members that are not on the page', () => {
    expect(reorderGroupMembers(['a', 'b'], ['ghost', 'b', 'a'])).toEqual(['b', 'a']);
  });
});
