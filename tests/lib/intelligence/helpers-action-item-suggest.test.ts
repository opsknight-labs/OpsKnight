import { describe, expect, it } from 'vitest';
import {
  findDuplicateActionItems,
  suggestActionItemOwner,
} from '@/lib/intelligence/helpers/action-item-suggest';

describe('action item duplicates', () => {
  const open = [
    { id: 'a', title: 'Add connection pool alerting for db-primary', incidentId: 'i1' },
    { id: 'b', title: 'Write runbook for cache eviction', incidentId: 'i2' },
    { id: 'c', title: 'Add connection pool alerts for db primary', incidentId: 'i3' },
  ];

  it('returns look-alike open items, most similar first', () => {
    const found = findDuplicateActionItems('Add connection pool alerting for db-primary', open);
    expect(found.map(item => item.id)).toEqual(['a', 'c']);
    expect(found[0].similarity).toBe(1);
  });

  it('ignores unrelated and very short titles', () => {
    expect(findDuplicateActionItems('Rotate TLS certificates', open)).toEqual([]);
    expect(findDuplicateActionItems('Add', open)).toEqual([]);
  });

  it('caps the result', () => {
    const many = Array.from({ length: 10 }, (_, n) => ({
      id: `x${n}`,
      title: `Add connection pool alerting ${n}`,
      incidentId: 'i',
    }));
    expect(findDuplicateActionItems('Add connection pool alerting', many)).toHaveLength(3);
  });
});

describe('suggested owner', () => {
  const lead = { id: 'u1', name: 'Lead' };
  const author = { id: 'u2', name: 'Author' };

  it('prefers the service team lead', () => {
    expect(suggestActionItemOwner({ teamLead: lead, author, teamName: 'Payments' })).toEqual({
      userId: 'u1',
      name: 'Lead',
      reason: 'Leads Payments, which owns the service',
    });
  });

  it('falls back to the postmortem author, then to nothing', () => {
    expect(suggestActionItemOwner({ teamLead: null, author, teamName: null })?.userId).toBe('u2');
    expect(suggestActionItemOwner({ teamLead: null, author: null, teamName: null })).toBeNull();
  });
});
