import { savedCitationSchema } from '@/lib/intelligence/conversations/contract';
import { describe, expect, it } from 'vitest';
import { routeIntent } from '@/lib/intelligence/squire/intents';
import {
  incidentQueryWhere,
  keywords,
  mergeBasicQuestion,
  parseBasicQuery,
} from '@/lib/intelligence/squire/basic/query';
import { productGuidance } from '@/lib/intelligence/squire/basic/guidance';
const now = new Date('2026-11-06T12:00:00Z');
describe('basic mode question catalog', () => {
  it.each([
    ['My open incidents', 'WORK_QUEUE'],
    ['Show unassigned incidents', 'WORK_QUEUE'],
    ['How many incidents today?', 'INCIDENT_STATS'],
    ['Which services are noisiest this week?', 'INCIDENT_STATS'],
    ['What is our MTTR this month?', 'INCIDENT_STATS'],
    ['How many alerts today?', 'ALERT_STATS'],
    ['Show recent checkout alerts', 'ALERT_STATS'],
    ['Who owns Checkout?', 'SERVICE_HEALTH'],
    ['What is the status of Checkout?', 'SERVICE_HEALTH'],
    ['Tell me about Checkout service', 'SERVICE_HEALTH'],
    ['How many services?', 'SERVICE_HEALTH'],
    ['List database runbooks', 'RUNBOOK_SEARCH'],
    ['How many runbooks?', 'RUNBOOK_SEARCH'],
    ['Recent deployments for Checkout', 'RECENT_CHANGES'],
    ['Show changes today', 'RECENT_CHANGES'],
    ['Show overdue action items', 'FOLLOWUPS'],
    ['My tasks', 'FOLLOWUPS'],
    ['Find database postmortems', 'POSTMORTEMS'],
    ['Who is on call for Checkout tomorrow?', 'ON_CALL'],
    ['How do on-call overrides work?', 'GUIDANCE'],
    ['How do I enable AI?', 'GUIDANCE'],
    ['What is OpsKnight?', 'GUIDANCE'],
    ['Does Squire use AI in basic mode?', 'GUIDANCE'],
    ['Show resolved incidents last week', 'SEARCH_INCIDENTS'],
  ])('routes %s to %s without a model', (message, expected) =>
    expect(routeIntent(message, false)).toBe(expected)
  );
  it('honors explicit global questions on an incident page', () => {
    expect(routeIntent('How many incidents today?', true)).toBe('INCIDENT_STATS');
    expect(routeIntent('Show resolved incidents last week', true)).toBe('SEARCH_INCIDENTS');
    expect(routeIntent('Who is assigned to this incident?', true)).toBe('RESPONDERS');
    expect(routeIntent('Which runbook fits?', true)).toBe('RUNBOOKS');
    expect(routeIntent('What changed before this started?', true)).toBe('CAUSES');
  });
  it.each([
    ['How do overrides work?', 'Schedules and overrides'],
    ['How do I configure notifications?', 'Notifications'],
    ['How do I enable AI?', 'Basic mode and AI'],
    ['Explain urgency and priority', 'Urgency and priority'],
    ['How long is history kept?', 'Saved chats'],
    ['What is SCIM?', 'Identity and access'],
  ])('provides specific product instructions for %s', (message, topic) =>
    expect(productGuidance(message)).toContain(`## ${topic}`)
  );
});
describe('bounded permission-scoped query parsing', () => {
  it('composes mine, status, urgency and priority without replacing the authorization scope', () => {
    const q = parseBasicQuery(
      'Show my high urgency P1 open checkout incidents from the past 7 days',
      now
    );
    expect(q).toMatchObject({
      mine: true,
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      terms: ['checkout'],
    });
    const readable = { serviceId: { in: ['visible'] } };
    const where = incidentQueryWhere(q, 'me', readable);
    expect(where.AND).toContainEqual(readable);
    expect(where.AND).toContainEqual({ assigneeId: 'me' });
    expect(where.AND).toContainEqual({ priority: 'P1' });
  });
  it('distinguishes personal work from team work and diagnoses conflicting filters', () => {
    expect(parseBasicQuery('my team unassigned incidents', now)).toMatchObject({
      mine: false,
      myTeams: true,
      unassigned: true,
    });
    expect(parseBasicQuery('my unassigned incidents', now).error).toContain('Choose either');
    expect(parseBasicQuery('not resolved incidents', now)).toMatchObject({
      status: undefined,
      active: true,
    });
    expect(parseBasicQuery('not high urgency incidents', now).error).toContain('explicit urgency');
  });
  it('uses local calendar days including a DST transition rather than rolling 24h days', () => {
    const q = parseBasicQuery(
      'incidents yesterday',
      new Date('2026-11-02T12:00:00Z'),
      'America/New_York'
    );
    expect(q.window?.gte.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(q.window?.lt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    const india = parseBasicQuery('incidents today', now, 'Asia/Kolkata');
    expect(india.window?.gte.toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });
  it('selects the event date the question actually asks about', () => {
    const q = parseBasicQuery('Show resolved incidents this week', now);
    expect(q.dateField).toBe('resolvedAt');
    expect(incidentQueryWhere(q, 'me', {}).AND).toContainEqual({
      resolvedAt: { gte: q.window!.gte, lt: q.window!.lt },
    });
    expect(parseBasicQuery('unacknowledged incidents', now).dateField).toBe('createdAt');
  });
  it('does not silently accept unbounded or ambiguous time filters', () => {
    for (const message of [
      'past 9999 days',
      'past 0 days',
      'incidents last year',
      'incidents since 2020',
    ])
      expect(parseBasicQuery(message, now).error).toBeTruthy();
    expect(parseBasicQuery('past 90 days', now).error).toBeUndefined();
  });
  it('replaces filters during a follow-up and keeps search keywords small', () => {
    const question = mergeBasicQuestion(
      'Show high urgency open checkout incidents yesterday',
      'And resolved incidents last week with low urgency?'
    );
    const q = parseBasicQuery(question, now);
    expect(q).toMatchObject({ urgency: 'LOW', status: 'RESOLVED', terms: ['checkout'] });
    expect(q.window?.label).toBe('the past 7 days');
    expect(keywords('Who is on call for "Checkout API" tomorrow?')).toEqual(['checkout', 'api']);
    expect(keywords('word '.repeat(10000))).toEqual(['word']);
  });
});

describe('expanded citations and conversational entity filters', () => {
  it.each([
    ['service', '/services/'],
    ['schedule', '/schedules/'],
    ['postmortem', '/postmortems/'],
  ] as const)('validates canonical %s citations in saved chats', (kind, prefix) => {
    const citation = { kind, id: 'known', label: 'Source', href: `${prefix}known` };
    expect(savedCitationSchema.safeParse(citation).success).toBe(true);
    expect(savedCitationSchema.safeParse({ ...citation, href: '/incidents/known' }).success).toBe(
      false
    );
    expect(
      savedCitationSchema.safeParse({ ...citation, href: 'https://evil.example' }).success
    ).toBe(false);
  });
  it('preserves quoted service names that are ordinary query words', () => {
    expect(keywords('Who owns "Status"?')).toEqual(['status']);
    expect(keywords('Who owns "123 Billing"?')).toEqual(['123', 'billing']);
    expect(keywords("what's on fire?")).toEqual([]);
    expect(parseBasicQuery('Find incidents for \"High Resolved P1\"', now)).toMatchObject({
      urgency: undefined,
      status: undefined,
      priority: undefined,
      terms: ['high', 'resolved', 'p1'],
    });
    expect(routeIntent('Who owns Checkout?', true)).toBe('SERVICE_HEALTH');
  });
  it('lets follow-ups replace a service without losing the other query filters', () => {
    const merged = mergeBasicQuestion(
      'Show high urgency open "Checkout API" incidents today',
      'And for "Payments Worker" yesterday?'
    );
    expect(parseBasicQuery(merged, now)).toMatchObject({
      terms: ['payments', 'worker'],
      urgency: 'HIGH',
      status: 'OPEN',
    });
    expect(parseBasicQuery(merged, now).window?.label).toContain('yesterday');
  });
});
