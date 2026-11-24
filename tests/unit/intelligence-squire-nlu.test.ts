import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  correctSpelling,
  editDistance,
  extractSlots,
  normalizeMessage,
  parseSlashCommand,
} from '@/lib/intelligence/squire/basic/nlu';
import { keywords, parseBasicQuery, resolveDayKey } from '@/lib/intelligence/squire/basic/query';
import { suggestFollowUps } from '@/lib/intelligence/squire/basic/suggestions';
import { productGuidance } from '@/lib/intelligence/squire/basic/guidance';
import { routeIntent, stripGreeting, type SquireIntent } from '@/lib/intelligence/squire/intents';

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

/** Findings from an adversarial review of basic mode (~310 inputs); each line reproduced the bug first. */
describe('adversarial review regressions', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const intent = (text: string, onIncident = false) =>
    classifyIntent(normalizeMessage(text), onIncident).intent;
  const slots = (text: string) => extractSlots(normalizeMessage(text), text);

  it('never turns time words, dates or filler into AND-ed search keywords', () => {
    for (const text of [
      'find incidents since monday',
      'incidents on the weekend',
      'any issues last night',
      'incidents since 2026-11-01',
      'incidents on 3rd nov',
      'incidents between mon and wed',
      'only high urgency incidents',
      'give me anything like this seen before',
      'show sev 1 incidents',
    ])
      expect(keywords(text), text).toEqual([]);
    expect(keywords('show me anything going on with checkout')).toEqual(['checkout']);
    expect(keywords('"since monday"')).toEqual(['since', 'monday']);
  });

  it('errors on a date that does not exist instead of dropping the filter', () => {
    expect(parseBasicQuery('incidents since 2026-02-30', now).error).toContain('not a date');
    expect(parseBasicQuery('incidents on 2026-02-30', now).error).toContain('not a date');
    expect(parseBasicQuery('incidents on 30 feb', now).error).toContain('not a date');
  });

  it('reads only real month names as dates and keeps scanning past a non-date', () => {
    expect(parseBasicQuery('marketing 5 incidents', now).error).toBeUndefined();
    expect(parseBasicQuery('marketing 5 incidents', now).window).toBeUndefined();
    expect(parseBasicQuery('show 5 incidents on 3 nov', now).window?.label).toContain('2026-11-03');
  });

  it('treats "open" as unresolved and maps sev/priority N to a priority filter', () => {
    expect(parseBasicQuery('open incidents', now)).toMatchObject({
      status: undefined,
      active: true,
    });
    expect(parseBasicQuery('incidents opened today', now).status).toBe('OPEN');
    expect(parseBasicQuery('sev 1 incidents', now).priority).toBe('P1');
    expect(parseBasicQuery('priority 2 incidents', now).priority).toBe('P2');
    expect(slots('show sev 1 incidents').limit).toBeUndefined();
    expect(slots('priority 1 incidents').limit).toBeUndefined();
  });

  it('keeps future and decimal durations out of look-back windows', () => {
    expect(normalizeMessage('who is on call for the next 3 days')).not.toContain('past');
    expect(normalizeMessage('who is on call in 2 hours')).toBe('who is on-call in 2 hours');
    expect(normalizeMessage('snooze 1.5h')).toBe('snooze 1.5h');
    expect(normalizeMessage('incidents in the last 24h')).toContain('past 24 hours');
    expect(slots('snooze 1.5h').snoozeMinutes).toBe(90);
    expect(slots('snooze for 2 weeks').snoozeMinutes).toBe(7 * 1440);
    expect(slots('snooze 30').snoozeMinutes).toBe(30);
    expect(slots('/snooze 2h'.replace('/snooze', 'snooze this incident')).snoozeMinutes).toBe(120);
  });

  it('maps me/myself to the actor and takes the assignee after "to"', () => {
    for (const text of ['assign this to me', 'assign to me', 'assign me', 'assign this to myself'])
      expect(slots(text), text).toMatchObject({ action: 'reassign', person: 'me' });
    expect(slots('assign this to Bob from my team')).toMatchObject({ person: 'Bob' });
    expect(slots("assign this to Alice O'Brien").person).toBe("Alice O'Brien");
    expect(slots('my open incidents').person).toBe('me');
  });

  it('reads whole names, and an email address is not a handle', () => {
    expect(slots('incidents assigned to José García').person).toBe('José García');
    expect(slots('incidents assigned to Mary Ann Smith').person).toBe('Mary Ann Smith');
    expect(slots('ping alice@example.com').person).toBeUndefined();
    expect(slots('incidents for @alice.').person).toBe('alice');
  });

  it('does not read list questions as action verbs', () => {
    for (const text of [
      'escalated incidents this week',
      'close incidents older than a week',
      'resolve time this week',
      'link to the runbook for redis',
      'log of the incident',
      'lower urgency incidents this week',
      'snoozed incidents',
      'assigned incidents',
    ])
      expect(slots(text).action, text).toBeUndefined();
    expect(slots('acknowledge this').action).toBe('acknowledge');
    expect(slots('escalate this incident').action).toBe('escalate');
    expect(slots('lower the urgency').action).toBe('urgency');
    expect(slots('resolve this: rolled back release 42').action).toBe('resolve');
    expect(slots('add a note customer impact confirmed').action).toBe('note');
  });

  it('extracts team names without grabbing verbs or other words', () => {
    expect(slots('which team owns checkout').team).toBeUndefined();
    expect(slots('is my team on call').team).toBeUndefined();
    expect(slots('incidents for checkout in the payments team').team).toBe('payments');
    expect(slots('incidents for the payments api team').team).toBe('payments api');
    expect(slots('incidents for team payments').team).toBe('payments');
  });

  it('recognises more ways of asking for the next page', () => {
    for (const text of ['show me more', 'load more', 'more please', 'ok show more', 'next page'])
      expect(slots(text).more, text).toBe(true);
    expect(slots('more incidents for checkout').more).toBe(false);
  });

  it('accepts the on_call and on-call slash aliases', () => {
    expect(parseSlashCommand('/on_call')).toEqual({ command: 'oncall', args: '' });
    expect(parseSlashCommand('/on-call checkout')).toEqual({ command: 'oncall', args: 'checkout' });
  });

  it('answers severity and urgency lists without asking which reading', () => {
    for (const text of [
      'p1 incidents',
      'incidents',
      'high urgency incidents',
      'checkout incidents?',
    ])
      expect(intent(text), text).toBe('SEARCH_INCIDENTS');
    expect(intent('incidents by team this week')).toBe('INCIDENT_STATS');
  });

  it('routes data questions away from product guidance', () => {
    expect(intent('what is the priority of INC-42', true)).toBe('INCIDENT_SUMMARY');
    expect(intent('what is the severity of this incident', true)).toBe('INCIDENT_SUMMARY');
    expect(intent('what is the history of this incident', true)).toBe('TIMELINE');
    expect(intent('what is the escalation policy for checkout')).toBe('SERVICE_HEALTH');
    expect(intent('how long does it take to resolve incidents on average')).toBe('INCIDENT_STATS');
    expect(intent('help me find runbooks for redis')).toBe('RUNBOOK_SEARCH');
    expect(intent('how do I acknowledge an incident?')).toBe('GUIDANCE');
    expect(intent('what is the priority of an incident used for')).toBe('GUIDANCE');
  });

  it('picks the most specific product guide', () => {
    expect(productGuidance('how do I set up sso in opsknight')).toContain('## Identity and access');
    expect(productGuidance('how does escalation work')).toContain('## Escalation and paging');
    expect(productGuidance('what is opsknight')).toContain('## OpsKnight');
  });

  it('routes questions about the incident on screen', () => {
    expect(intent('what is the status of this incident', true)).toBe('INCIDENT_SUMMARY');
    expect(intent('is it resolved?', true)).toBe('INCIDENT_SUMMARY');
    expect(intent('who resolved it', true)).toBe('TIMELINE');
    expect(intent('show incidents assigned to Alice', true)).toBe('SEARCH_INCIDENTS');
    expect(intent('who is assigned to this incident?', true)).toBe('RESPONDERS');
  });

  it('greets only greetings, and strips stacked greetings once', () => {
    for (const text of ['morning briefing', 'hey oncall?', 'yo status?', 'hi incidents'])
      expect(routeIntent(normalizeMessage(text), false), text).not.toBe('GREETING');
    for (const text of ['hey 👋', 'hey squire!', 'good morning team', 'hi there'])
      expect(routeIntent(normalizeMessage(text), false), text).toBe('GREETING');
    expect(routeIntent('morning briefing', false)).toBe('CATCH_UP');
    expect(routeIntent('cool, thanks', false)).toBe('THANKS');
    expect(routeIntent('ok great, thanks!', false)).toBe('THANKS');
    expect(stripGreeting('hey hi there, any open incidents?')).toEqual({
      greeted: true,
      rest: 'any open incidents?',
    });
    expect(stripGreeting('Hey Knight! my queue', 'Knight')).toEqual({
      greeted: true,
      rest: 'my queue',
    });
    expect(stripGreeting("what's up with checkout?").greeted).toBe(false);
    expect(normalizeMessage("what's up with checkout?")).toBe('what is going on with checkout?');
    expect(intent('how is it going with the payments outage')).toBe('ACTIVE_INCIDENTS');
    const started = performance.now();
    expect(stripGreeting('hey '.repeat(500)).rest).toBe('');
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('offers chips that each read as a question after their answer', () => {
    const chips = [
      ...suggestFollowUps({ intent: 'SEARCH_INCIDENTS', incident: null, mode: 'basic' }),
      ...suggestFollowUps({ intent: 'INCIDENT_STATS', incident: null, mode: 'basic' }),
      ...suggestFollowUps({ intent: 'RECENT_CHANGES', incident: null, mode: 'basic' }),
    ];
    expect(chips).not.toContain('Incidents since those changes');
    for (const chip of chips) expect(keywords(chip), chip).toEqual([]);
  });
});
