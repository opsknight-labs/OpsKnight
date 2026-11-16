import { describe, expect, it } from 'vitest';
import { draftStatusUpdate } from '@/lib/intelligence/helpers/status-draft';

const edge = (downstreamServiceId: string, upstreamServiceId: string) => ({
  downstreamServiceId,
  upstreamServiceId,
});
const incident = (data: Partial<Parameters<typeof draftStatusUpdate>[0]> = {}) => ({
  id: 'inc-1',
  title: 'pg-primary-3 replication lag, ticket SEC-991',
  status: 'OPEN',
  urgency: 'HIGH',
  serviceId: 'db',
  ...data,
});
const components = [
  { serviceId: 'web', name: 'Website' },
  { serviceId: 'api', name: 'Public API' },
  { serviceId: 'db', name: 'Database' },
  { serviceId: 'mail', name: 'Email' },
];
// web -> api -> db; reports -> web (three hops from db); mail is unrelated.
const edges = [edge('api', 'db'), edge('web', 'api'), edge('reports', 'web')];

describe('status update drafted from an incident', () => {
  it('pre-selects the incident component, then the components that depend on it, nearest first', () => {
    const draft = draftStatusUpdate(incident(), components, edges);
    expect(draft?.affected).toEqual([
      { serviceId: 'db', name: 'Database', reason: 'SOURCE' },
      { serviceId: 'api', name: 'Public API', reason: 'DEPENDS_ON_SOURCE' },
      { serviceId: 'web', name: 'Website', reason: 'DEPENDS_ON_SOURCE' },
    ]);
    expect(draft?.type).toBe('INCIDENT');
    expect(draft?.title).toBe('Investigating: issue affecting Database, Public API and Website');
  });

  it('never copies the internal incident title into the public text', () => {
    const draft = draftStatusUpdate(incident(), components, edges);
    expect(`${draft?.title} ${draft?.message}`).not.toMatch(/pg-primary|SEC-991/);
    expect(draft?.incidentTitle).toContain('pg-primary-3');
  });

  it('stops at two hops and ignores components nothing connects to the incident', () => {
    const draft = draftStatusUpdate(
      incident(),
      [...components, { serviceId: 'reports', name: 'Reports' }],
      edges
    );
    expect(draft?.affected.map(component => component.serviceId)).toEqual(['db', 'api', 'web']);
  });

  it('drafts for a hidden upstream service when a shown component depends on it', () => {
    const draft = draftStatusUpdate(
      incident({ serviceId: 'api', urgency: 'LOW' }),
      components.filter(component => component.serviceId !== 'api'),
      edges
    );
    expect(draft?.affected).toEqual([
      { serviceId: 'web', name: 'Website', reason: 'DEPENDS_ON_SOURCE' },
    ]);
    expect(draft?.type).toBe('WARNING');
    expect(draft?.title).toBe('Investigating: issue affecting Website');
  });

  it('says "identified" once someone has acknowledged the incident', () => {
    const draft = draftStatusUpdate(incident({ status: 'ACKNOWLEDGED' }), components, edges);
    expect(draft?.title).toMatch(/^Identified: /);
    expect(draft?.message).toMatch(/^We have identified an issue/);
  });

  it('counts components beyond the third instead of listing them', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ serviceId: id, name: id.toUpperCase() }));
    const draft = draftStatusUpdate(
      incident({ serviceId: 'a' }),
      many,
      many.slice(1).map(component => edge(component.serviceId, 'a'))
    );
    expect(draft?.title).toBe('Investigating: issue affecting A, B, C and 2 more');
  });

  it('returns nothing when the incident touches no component on the page (also with cycles)', () => {
    expect(
      draftStatusUpdate(incident({ serviceId: 'x' }), components, [edge('x', 'y'), edge('y', 'x')])
    ).toBeNull();
  });
});
