import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  correctSpelling,
  editDistance,
  extractSlots,
  normalizeMessage,
  parseSlashCommand,
} from '@/lib/intelligence/squire/basic/nlu';
import { parseBasicQuery, resolveDayKey } from '@/lib/intelligence/squire/basic/query';
import { suggestFollowUps } from '@/lib/intelligence/squire/basic/suggestions';
import type { SquireIntent } from '@/lib/intelligence/squire/intents';

type Case = {
  text: string;
  intent: SquireIntent;
  onIncident?: boolean;
  slots?: Record<string, unknown>;
};

/**
 * A paraphrase corpus: each intent phrased many ways, with typos, contractions and shorthand. The accuracy
 * floor is the contract; individual rows are not pinned, so vocabulary can grow without churn.
 */
const CORPUS: Case[] = [
  // WORK_QUEUE
  ...[
    'My open incidents',
    'my incidents',
    'what is assigned to me',
    'show me my queue',
    'whats on my plate',
    'my workload',
    'Show unassigned incidents',
    'incidents nobody owns',
    'unacknowledged incidents',
    'unresolved incidents assigned to me',
    'my high urgency incidents',
    'my incidnets',
    'mine',
    'what am i working on',
    'my acknowledged incidents',
    'list unassigned incidents today',
  ].map(text => ({ text, intent: 'WORK_QUEUE' as const })),
  // ACTIVE_INCIDENTS
  ...[
    'What is on fire right now?',
    "what's on fire",
    'whats broken',
    "what's down",
    'what is happening',
    'active incidents',
    'open incidents right now',
    'incidents now',
    'anything burning?',
    'what is going on right now',
    'show me open incidnets right now',
    'what outages are ongoing',
  ].map(text => ({ text, intent: 'ACTIVE_INCIDENTS' as const })),
  // INCIDENT_STATS
  ...[
    'How many incidents today?',
    'how many incidents this week',
    'number of incidents yesterday',
    'incident count this month',
    'Which services are noisiest this week?',
    'noisiest services',
    'What is our MTTR this month?',
    'mean time to resolution',
    'average resolution time last week',
    'incident statistics',
    'incident stats by team',
    'incidents by team this week',
    'incidents by urgency this week',
    'incidents per day this month',
    'incident trend',
    'how many incidnets today',
    'how many incidents in the past 24h',
    'how many outages last 7d',
    'incident volume by service',
    'mtta this week',
    'what is the mean time to acknowledge',
    'incident report for the payments team',
    'how many high urgency incidents this week',
    'incident analytics',
    'compare incidents this week',
    'breakdown of incidents by status',
  ].map(text => ({ text, intent: 'INCIDENT_STATS' as const })),
  // ALERT_STATS
  ...[
    'How many alerts today?',
    'Show recent checkout alerts',
    'alert count this week',
    'list alerts',
    'how many alerts fired yesterday',
    'recent alerts',
    'number of alerts for checkout',
    'alerts in the past 24h',
    'show me the latest alerts',
    'how many alerst today',
    'alert statistics',
    'find alerts for payments',
  ].map(text => ({ text, intent: 'ALERT_STATS' as const })),
  // SERVICE_HEALTH
  ...[
    'Who owns Checkout?',
    'What is the status of Checkout?',
    'Tell me about Checkout service',
    'How many services?',
    'list services',
    'who maintains payments',
    'which team owns the api gateway',
    'service health of checkout',
    'health of payments',
    'what does checkout depend on',
    'upstream dependencies of checkout',
    'escalation policy for checkout',
    'service owner for billing',
    'who is responsible for checkout',
    'owning team of the checkout service',
    'show services',
    'services overview',
    'who owns chekout',
    'status of the payments servce',
    'what is the health of billing',
  ].map(text => ({ text, intent: 'SERVICE_HEALTH' as const })),
  // RUNBOOK_SEARCH
  ...[
    'List database runbooks',
    'How many runbooks?',
    'find runbooks about kafka',
    'runbook catalog',
    'search runbooks for disk',
    'show playbooks',
    'runbooks for checkout',
    'which runbooks exist',
    'list runbooks',
    'runbooks about dns',
    'find a runbok for the database',
    'show me runbooks',
  ].map(text => ({ text, intent: 'RUNBOOK_SEARCH' as const })),
  // RECENT_CHANGES
  ...[
    'Recent deployments for Checkout',
    'Show changes today',
    'what changed yesterday',
    'latest deploys',
    'recent releases',
    'what was deployed this week',
    'list changes for payments',
    'show recent config changes',
    'deployments in the past 24h',
    'what changed in checkout',
    'latest deployments',
    'recent deployes',
    'show changes since monday',
    'what shipped today',
  ].map(text => ({ text, intent: 'RECENT_CHANGES' as const })),
  // FOLLOWUPS
  ...[
    'Show overdue action items',
    'My tasks',
    'follow-ups',
    'open action items',
    'overdue follow ups',
    'what tasks are pending',
    'my follow-up items',
    'show followups for checkout',
    'outstanding action items',
    'overdue tasks',
    'my action items',
    'list follow ups',
  ].map(text => ({ text, intent: 'FOLLOWUPS' as const })),
  // POSTMORTEMS
  ...[
    'Find database postmortems',
    'recent postmortems',
    'postmortems for checkout',
    'show postmortems',
    'list post-mortems',
    'postmortem about kafka',
    'any postmortems this month',
    'search postmortems',
    'postmortems',
    'find postmortms about disk',
  ].map(text => ({ text, intent: 'POSTMORTEMS' as const })),
  // ON_CALL
  ...[
    'Who is on call for Checkout tomorrow?',
    'who is on call',
    "who's on call",
    'who is on-call right now',
    'who is oncall for payments',
    'who is up for checkout',
    'who is covering checkout tonight',
    'on call for billing in 2 hours',
    'who is on call tomorrow',
    'whos on call for the api',
    'who should i page for checkout',
    'current on call',
    'who is responding right now',
    'who is on cal for checkout',
  ].map(text => ({ text, intent: 'ON_CALL' as const })),
  // SEARCH_INCIDENTS
  ...[
    'Show resolved incidents last week',
    'find checkout incidents from last week',
    'search incidents about database',
    'list incidents yesterday',
    'resolved incidents this month',
    'find incidents since monday',
    'show incidents between monday and wednesday',
    'incidents last 7d',
    'find kafka incidents',
    'any incidents for payments this week',
    'show high urgency incidents last week',
    'were there incidents yesterday',
    'incidents on friday',
    'find incidnets about disk',
    'list resolved incidents since 2026-11-01',
    'show p1 incidents this week',
    'search outages last month',
    'show incidents for the payments team',
  ].map(text => ({ text, intent: 'SEARCH_INCIDENTS' as const })),
  // GUIDANCE
  ...[
    'How do on-call overrides work?',
    'How do I enable AI?',
    'What is OpsKnight?',
    'Does Squire use AI in basic mode?',
    'how do i acknowledge an incident',
    'how do schedules work',
    'how do i configure notifications',
    'explain urgency and priority',
    'how do i set up an integration',
    'what is scim',
  ].map(text => ({ text, intent: 'GUIDANCE' as const })),
  // HELP / GREETING / THANKS
  ...['help', 'what can you do', 'Help!', 'commands'].map(text => ({
    text,
    intent: 'HELP' as const,
  })),
  ...['hi', 'hello', 'hey', 'good morning'].map(text => ({ text, intent: 'GREETING' as const })),
  ...['thanks', 'thank you', 'thx', 'ok'].map(text => ({ text, intent: 'THANKS' as const })),
  // On an incident page
  ...[
    'Which runbook fits?',
    'what should i do',
    'how do we fix this',
    'next steps',
    'runbook for this',
    'remediation',
  ].map(text => ({ text, intent: 'RUNBOOKS' as const, onIncident: true })),
  ...[
    'What changed before this started?',
    'why did this happen',
    'root cause',
    'what broke',
    'was there a deploy before this',
    'probable cause',
  ].map(text => ({ text, intent: 'CAUSES' as const, onIncident: true })),
  ...[
    'Have we seen this before?',
    'similar incidents',
    'has this happened before',
    'any precedent',
    'past incidents like this',
    'is this recurring',
  ].map(text => ({ text, intent: 'SIMILAR' as const, onIncident: true })),
  ...[
    'show the timeline',
    'what happened so far',
    'sequence of events',
    'when did this start',
    'chronology',
  ].map(text => ({ text, intent: 'TIMELINE' as const, onIncident: true })),
  ...[
    'Who is assigned to this incident?',
    'who is working on this',
    'responders',
    'who owns this incident',
    'escalation status',
  ].map(text => ({ text, intent: 'RESPONDERS' as const, onIncident: true })),
  ...[
    'summarise this incident',
    'give me a briefing',
    'overview',
    'tl;dr',
    'catch me up',
    'what is this',
  ].map(text => ({ text, intent: 'INCIDENT_SUMMARY' as const, onIncident: true })),
  ...['How many incidents today?', 'Show resolved incidents last week', 'who is on call'].map(
    text => ({
      text,
      intent: text.startsWith('How')
        ? ('INCIDENT_STATS' as const)
        : text.startsWith('Show')
          ? ('SEARCH_INCIDENTS' as const)
          : ('ON_CALL' as const),
      onIncident: true,
    })
  ),
  // More paraphrases, typos and shorthand
  ...[
    'show me what is assigned to me',
    'anything unassigned?',
    'my unresolved incidnets',
    'incidents i own',
    'what is in my queue',
  ].map(text => ({ text, intent: 'WORK_QUEUE' as const })),
  ...[
    'what is broken right now',
    'current outages',
    'ongoing incidents',
    'is anything on fire',
    'what is down right now',
  ].map(text => ({ text, intent: 'ACTIVE_INCIDENTS' as const })),
  ...[
    'incident count by service this week',
    'how many incidents did we have yesterday',
    'incidents per hour today',
    'which team has the most incidents',
    'total incidents past 30 days',
    'incident stats for payments this month',
    'how many p1 incidents last month',
    'mttr for checkout this week',
    'average time to acknowledge last week',
    'top 10 noisiest services',
  ].map(text => ({ text, intent: 'INCIDENT_STATS' as const })),
  ...[
    'count alerts this week',
    'alerts yesterday',
    'how many triggered alerts today',
    'list recent alerts for billing',
  ].map(text => ({ text, intent: 'ALERT_STATS' as const })),
  ...[
    'who looks after the billing service',
    'ownership of checkout',
    'dependencies of payments',
    'what depends on billing',
    'health status of the api gateway',
    'tell me about the payments service',
    'which services do we have',
  ].map(text => ({ text, intent: 'SERVICE_HEALTH' as const })),
  ...[
    'runbooks about kafka lag',
    'is there a runbook for disk full',
    'list playbooks for database',
    'how many runbooks do we have',
  ].map(text => ({ text, intent: 'RUNBOOK_SEARCH' as const })),
  ...[
    'recent changes for billing',
    'what was released yesterday',
    'show deployments for checkout this week',
    'list deploys since monday',
    'feature flag changes today',
  ].map(text => ({ text, intent: 'RECENT_CHANGES' as const })),
  ...[
    'pending follow-ups for checkout',
    'overdue action items for my team',
    'show my open tasks',
    'what remediation items are outstanding',
  ].map(text => ({ text, intent: 'FOLLOWUPS' as const })),
  ...[
    'show me the latest postmortems',
    'postmortems from last month',
    'any post-mortem for the kafka outage',
    'find a retrospective about dns',
  ].map(text => ({ text, intent: 'POSTMORTEMS' as const })),
  ...[
    'who is on call for billing',
    'on-call for checkout tomorrow',
    'who is covering payments in 3 hours',
    'who do i page for the api',
    'who is on call right now for checkout',
    'on call coverage for checkout',
  ].map(text => ({ text, intent: 'ON_CALL' as const })),
  ...[
    'find resolved incidents for checkout yesterday',
    'incidents between monday and wednesday for billing',
    'show acknowledged incidents today',
    'search incidents about kafka last week',
    'list incidents on friday',
    'find high urgency incidents since 2026-11-01',
    'show incidents for billing in the past 48h',
    'incidents for the checkout team',
    'incidents assigned to Eval Responder',
    'incidents about kafka',
  ].map(text => ({ text, intent: 'SEARCH_INCIDENTS' as const })),
  ...[
    'how do i snooze an incident',
    'how do escalation policies work',
    'how do i set up sso',
    'how long is chat history kept',
    'what does basic mode do',
  ].map(text => ({ text, intent: 'GUIDANCE' as const })),
];

describe('basic-mode understanding corpus', () => {
  it('classifies at least 95% of the paraphrase corpus correctly', () => {
    const failures: string[] = [];
    for (const row of CORPUS) {
      const normalized = correctSpelling(normalizeMessage(row.text)).text;
      const prediction = classifyIntent(normalized, row.onIncident ?? false);
      if (prediction.intent !== row.intent)
        failures.push(
          `${JSON.stringify(row.text)} → ${prediction.intent} (expected ${row.intent})`
        );
    }
    const accuracy = 1 - failures.length / CORPUS.length;
    expect(CORPUS.length).toBeGreaterThanOrEqual(250);
    expect(failures.join('\n')).toSatisfy(() => accuracy >= 0.95);
  });

  it('never routes a non-incident question to an incident-only intent off the incident page', () => {
    for (const row of CORPUS.filter(row => !row.onIncident)) {
      const prediction = classifyIntent(correctSpelling(normalizeMessage(row.text)).text, false);
      expect([
        'SIMILAR',
        'CAUSES',
        'RUNBOOKS',
        'TIMELINE',
        'RESPONDERS',
        'INCIDENT_SUMMARY',
      ]).not.toContain(prediction.intent);
    }
  });

  it('offers two readings instead of guessing when a message is ambiguous', () => {
    const prediction = classifyIntent('recent', false);
    expect(prediction.intent).toBe('UNKNOWN');
    expect(classifyIntent('deploys and incidents', false).alternatives.length).toBeGreaterThan(0);
  });
});

describe('slot extraction', () => {
  const slot = (text: string) => extractSlots(normalizeMessage(text), text);
  const cases: Array<[string, Record<string, unknown>]> = [
    ['top 10 noisiest services', { limit: 10 }],
    ['show 3 incidents', { limit: 3 }],
    ['incidents by team this week', { groupBy: 'team' }],
    ['incidents per day', { groupBy: 'day' }],
    ['breakdown by urgency', { groupBy: 'urgency' }],
    ['incidents for the payments team', { team: 'payments' }],
    ['team platform incidents', { team: 'platform' }],
    ['incidents assigned to Alice Smith', { person: 'Alice Smith' }],
    ['what is assigned to @alice', { person: 'alice' }],
    ['my open incidents', { person: 'me' }],
    ['show more', { more: true }],
    ['next', { more: true }],
    ['more', { more: true }],
    ['acknowledge this', { action: 'acknowledge' }],
    ['ack it', { action: 'acknowledge' }],
    ['resolve this: rolled back v42', { action: 'resolve', actionText: 'rolled back v42' }],
    [
      'add a note: customer impact confirmed',
      { action: 'note', actionText: 'customer impact confirmed' },
    ],
    ['assign this to Bob Jones', { action: 'reassign', person: 'Bob Jones' }],
    ['snooze for 2 hours', { action: 'snooze', snoozeMinutes: 120 }],
    ['how do i acknowledge an incident?', {}],
  ];
  it.each(cases)('extracts slots from %s', (text, expected) => {
    expect(slot(text)).toMatchObject(expected);
  });
  it('accuracy over the slot cases is at least 90%', () => {
    const misses = cases.filter(([text, expected]) => {
      const actual = slot(text) as unknown as Record<string, unknown>;
      // eslint-disable-next-line security/detect-object-injection -- keys come from the fixed case table
      return Object.entries(expected).some(([key, value]) => actual[key] !== value);
    });
    expect(1 - misses.length / cases.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('normalisation and spelling', () => {
  it('expands shorthand windows and contractions', () => {
    expect(normalizeMessage("What's on fire in the last 24h?")).toBe(
      'what is on fire in the past 24 hours?'
    );
    expect(normalizeMessage('incidents 7d')).toBe('incidents past 7 days');
    expect(normalizeMessage('who’s on call')).toContain('who');
    expect(normalizeMessage('past hour')).toBe('past 1 hours');
  });
  it('corrects near misses but leaves names, quotes and identifiers alone', () => {
    expect(correctSpelling('my open incidnets').text).toBe('my open incidents');
    expect(correctSpelling('who owns "chekout"').text).toBe('who owns "chekout"');
    expect(correctSpelling('who owns chekout', ['Chekout']).text).toBe('who owns chekout');
    expect(correctSpelling('incident cmabc123def456ghi789').text).toContain('cmabc123def456ghi789');
    expect(correctSpelling('postmortms about disk').corrections).toEqual([
      { from: 'postmortms', to: 'postmortems' },
    ]);
  });
  it('bounds edit distance work', () => {
    expect(editDistance('incident', 'incidnet')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });
});

describe('bounded work on adversarial input', () => {
  it('understands a maximum-length hostile message quickly', () => {
    const hostile = [
      'a'.repeat(2_000),
      'past '.repeat(400),
      `${'incident '.repeat(200)}?`,
      'between monday and '.repeat(100),
      '@'.repeat(2_000),
      'resolve this: '.repeat(140),
    ];
    for (const message of hostile) {
      const started = performance.now();
      const normalized = correctSpelling(normalizeMessage(message)).text;
      classifyIntent(normalized, true);
      extractSlots(normalized, message);
      parseBasicQuery(normalized, new Date('2026-11-06T12:00:00Z'), 'UTC');
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});

describe('slash commands', () => {
  it('parses commands and aliases', () => {
    expect(parseSlashCommand('/ack')).toEqual({ command: 'ack', args: '' });
    expect(parseSlashCommand('/resolve rolled back the deploy')).toEqual({
      command: 'resolve',
      args: 'rolled back the deploy',
    });
    expect(parseSlashCommand('/oncall Checkout')).toEqual({ command: 'oncall', args: 'Checkout' });
    expect(parseSlashCommand('/acknowledge')).toEqual({ command: 'ack', args: '' });
    expect(parseSlashCommand('/unknown thing')).toBeNull();
    expect(parseSlashCommand('not a command')).toBeNull();
  });
});

describe('calendar expressions', () => {
  const now = new Date('2026-11-06T12:00:00Z'); // a Friday
  it('resolves weekdays, dates and month names into local days', () => {
    expect(resolveDayKey('monday', '2026-11-06')).toBe('2026-11-02');
    expect(resolveDayKey('last friday', '2026-11-06')).toBe('2026-10-30');
    expect(resolveDayKey('this wednesday', '2026-11-06')).toBe('2026-11-04');
    expect(resolveDayKey('this saturday', '2026-11-06')).toBeNull();
    expect(resolveDayKey('2026-11-01', '2026-11-06')).toBe('2026-11-01');
    expect(resolveDayKey('5 nov', '2026-11-06')).toBe('2026-11-05');
    expect(resolveDayKey('nov 5', '2026-11-06')).toBe('2026-11-05');
    expect(resolveDayKey('december 25', '2026-11-06')).toBe('2025-12-25');
    expect(resolveDayKey('2026-11-30', '2026-11-06')).toBeNull();
    expect(resolveDayKey('2020', '2026-11-06')).toBeNull();
  });
  it('builds since, between and single-day windows', () => {
    const since = parseBasicQuery('incidents since monday', now, 'UTC');
    expect(since.error).toBeUndefined();
    expect(since.window?.gte.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(since.window?.lt.toISOString()).toBe(now.toISOString());
    const between = parseBasicQuery('incidents between monday and wednesday', now, 'UTC');
    expect(between.window?.gte.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(between.window?.lt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    const day = parseBasicQuery('incidents on 2026-11-03', now, 'UTC');
    expect(day.window?.label).toContain('Tuesday 2026-11-03');
    const friday = parseBasicQuery('show incidents last friday', now, 'Asia/Kolkata');
    expect(friday.window?.gte.toISOString()).toBe('2026-10-29T18:30:00.000Z');
    expect(parseBasicQuery('incidents since 2026-01-01', now, 'UTC').error).toContain('90 days');
    expect(parseBasicQuery('incidents since 2026-11-20', now, 'UTC').error).toContain('future');
    expect(parseBasicQuery('incidents since 2020', now, 'UTC').error).toBeTruthy();
    expect(parseBasicQuery('incidents last year', now, 'UTC').error).toBeTruthy();
    expect(parseBasicQuery('top 10 services', now, 'UTC').window).toBeUndefined();
  });
});

describe('answer-aware suggestions', () => {
  it('offers paging and narrowing after a list, and breakdowns after a report', () => {
    expect(
      suggestFollowUps({
        intent: 'SEARCH_INCIDENTS',
        incident: null,
        mode: 'basic',
        hasMore: true,
      })[0]
    ).toBe('Show more');
    expect(suggestFollowUps({ intent: 'INCIDENT_STATS', incident: null, mode: 'basic' })).toContain(
      'Break it down by team'
    );
    expect(suggestFollowUps({ intent: 'SERVICE_HEALTH', incident: null, mode: 'basic' })).toContain(
      'Who is on call for it?'
    );
    expect(
      suggestFollowUps({ intent: 'UNKNOWN', incident: null, mode: 'basic', choices: ['A', 'B'] })
    ).toEqual(['A', 'B']);
    expect(
      suggestFollowUps({ intent: 'UNKNOWN', incident: null, mode: 'basic' }).length
    ).toBeLessThanOrEqual(4);
  });
});
