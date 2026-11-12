import { describe, expect, it } from 'vitest';
import { incidentIdFromPath, pageContextFromPath } from '@/components/squire/page-context';
import { squireRequestSchema } from '@/lib/intelligence/squire/contract';

describe('Squire page context from the URL', () => {
  it.each([
    ['/services/svc_1', { kind: 'service', id: 'svc_1' }],
    ['/m/services/svc_1/automation', { kind: 'service', id: 'svc_1' }],
    ['/teams/t1', { kind: 'team', id: 't1' }],
    ['/schedules/s1', { kind: 'schedule', id: 's1' }],
    ['/m/schedules/s1', { kind: 'schedule', id: 's1' }],
    ['/runbooks/rb1', { kind: 'runbook', id: 'rb1' }],
    ['/runbooks/rb1/compare', { kind: 'runbook', id: 'rb1' }],
    ['/alerts/a1', { kind: 'alert', id: 'a1' }],
    ['/changes/c1', { kind: 'change', id: 'c1' }],
  ])('%s', (path, expected) => {
    expect(pageContextFromPath(path)).toEqual(expected);
    // Every kind the browser sends is accepted by the request contract.
    expect(squireRequestSchema.safeParse({ message: 'hi', pageContext: expected }).success).toBe(
      true
    );
  });

  it.each([
    '/services',
    '/services/new',
    '/runbooks/agents',
    '/runbooks/executions/x',
    '/runbooks/health',
    '/',
    '/settings/x',
  ])('ignores %s', path => expect(pageContextFromPath(path)).toBeUndefined());

  it('reads the incident from desktop and mobile incident pages', () => {
    expect(incidentIdFromPath('/incidents/inc_1/overview')).toBe('inc_1');
    expect(incidentIdFromPath('/m/incidents/inc_1')).toBe('inc_1');
    expect(incidentIdFromPath('/incidents/new')).toBeUndefined();
    expect(incidentIdFromPath('/m/incidents/create')).toBeUndefined();
    expect(incidentIdFromPath('/services/x')).toBeUndefined();
  });
});
