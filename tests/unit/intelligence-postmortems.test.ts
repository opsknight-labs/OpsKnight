import { describe, expect, it } from 'vitest';
import {
  applyEvidenceToDraft,
  findDuplicateActionItem,
  suggestActionItems,
  type PostmortemEvidence,
} from '@/lib/intelligence/postmortems/evidence-draft';
import { checkPostmortemQuality, timelineGaps } from '@/lib/intelligence/postmortems/quality';
import {
  recurrenceHeadline,
  type PostmortemRecurrence,
} from '@/lib/intelligence/postmortems/recurrence';
import { opsInsightItemSchema } from '@/lib/intelligence/ops-insights/contract';
import { OPS_INSIGHT_PRODUCERS } from '@/lib/intelligence/ops-insights/producers';
import {
  REPEAT_CAUSE_KIND,
  repeatCauseProducer,
  type RepeatCauseInput,
} from '@/lib/intelligence/ops-insights/producers/postmortem-repeat-cause';
import { postmortemKnowledgeBody } from '@/lib/intelligence/memory/contract';

const NOW = new Date('2026-11-11T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const at = (time: string) => new Date(`2026-11-10T${time}:00Z`);

const noEvidence: PostmortemEvidence = {
  axis: [],
  changes: [],
  upstreamIncidents: [],
  runbookRuns: [],
  similarFixes: [],
  recurrence: null,
};

const base = {
  summary: 'Template summary',
  timeline: [
    {
      id: 'draft-start',
      timestamp: at('10:00').toISOString(),
      type: 'DETECTION' as const,
      title: 'Incident Started',
      description: 'Incident created',
    },
  ],
  rootCause: 'To be determined. Preliminary analysis suggests...',
  resolution: 'Service was restored by...',
  lessons: '1. Improve monitoring for...',
};

const recurrence: PostmortemRecurrence = {
  template: 'Disk full on host-<n>',
  windowDays: 90,
  occurrences: 4,
  capped: false,
  previous: [{ incidentId: 'inc-3', title: 'Disk full on host-3', createdAt: daysAgo(5) }],
  lastPostmortem: {
    incidentId: 'inc-3',
    title: 'Disk full postmortem',
    status: 'PUBLISHED',
    createdAt: daysAgo(4),
  },
  openActionItems: [
    {
      id: 'ai-1',
      title: 'Add log rotation to the batch hosts',
      status: 'OPEN',
      priority: 'HIGH',
      dueDate: daysAgo(10),
      incidentId: 'inc-3',
      overdue: true,
    },
  ],
  openActionItemCount: 1,
  overdueActionItemCount: 1,
};

describe('repeat cause with an overdue action item (producer derive)', () => {
  const problem = {
    key: 'hash-disk',
    occurrences: 4,
    lastSeenDay: '2026-11-10',
    latestIncidentId: 'inc-4',
    overdue: [
      { id: 'ai-2', incidentId: 'inc-2', high: false, dueDay: '2026-11-08', daysLate: 3 },
      { id: 'ai-1', incidentId: 'inc-1', high: false, dueDay: '2026-10-02', daysLate: 40 },
    ],
  };
  const derive = (problems: RepeatCauseInput['problems']) =>
    repeatCauseProducer.derive({ windowDays: 90, problems });

  it('is registered once, for services, behind the postmortems switch', () => {
    expect(OPS_INSIGHT_PRODUCERS.filter(item => item.kind === REPEAT_CAUSE_KIND)).toHaveLength(1);
    expect(repeatCauseProducer).toMatchObject({ area: 'postmortems', scopeType: 'SERVICE' });
  });

  it('reports one insight per recurring problem with the numbers and links behind it', () => {
    const [item, ...rest] = derive([problem]);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      key: 'hash-disk',
      severity: 'CRITICAL', // 40 days late on a problem seen four times
      title: 'Repeat problem, seen 4 times, has 2 overdue action items',
      draftHref: '/postmortems/inc-1',
      evidence: {
        window: 'last 90 days',
        facts: [
          { label: 'Occurrences', value: '4' },
          { label: 'Last seen', value: '2026-11-10' },
          { label: 'Overdue action items', value: '2' },
          { label: 'Longest overdue', value: '40 days' },
        ],
      },
    });
    expect(item.evidence.examples).toEqual([
      { label: 'Action item due 2026-10-02', href: '/postmortems/inc-1' },
      { label: 'Action item due 2026-11-08', href: '/postmortems/inc-2' },
      { label: 'Latest occurrence', href: '/incidents/inc-4' },
    ]);
    // Every item passes the store's contract.
    expect(opsInsightItemSchema.safeParse(item).success).toBe(true);
  });

  it('is a warning when the follow-up is recent and not high priority, critical when it is high priority', () => {
    const recent = { ...problem, overdue: [problem.overdue[0]] };
    expect(derive([recent])[0].severity).toBe('WARNING');
    const high = { ...recent, overdue: [{ ...recent.overdue[0], high: true }] };
    expect(derive([high])[0].severity).toBe('CRITICAL');
    expect(derive([high])[0].evidence.examples?.[0].label).toBe(
      'High-priority action item due 2026-11-08'
    );
    // Seen only twice: never critical.
    expect(derive([{ ...high, occurrences: 2 }])[0].severity).toBe('WARNING');
  });

  it('says nothing for a single occurrence or without overdue items', () => {
    expect(
      derive([
        { ...problem, key: 'once', occurrences: 1 },
        { ...problem, key: 'clean', overdue: [] },
      ])
    ).toEqual([]);
  });

  it('orders critical first and is stable', () => {
    const warning = { ...problem, key: 'a-warning', overdue: [problem.overdue[0]] };
    const items = derive([warning, problem]);
    expect(items.map(item => item.key)).toEqual(['hash-disk', 'a-warning']);
    expect(items).toEqual(derive([warning, problem]));
  });
});

describe('recurrence headline', () => {
  it('stays silent on a first occurrence and marks a capped count', () => {
    expect(recurrenceHeadline({ occurrences: 1, capped: false, windowDays: 90 })).toBeNull();
    expect(recurrenceHeadline({ occurrences: 4, capped: false, windowDays: 90 })).toBe(
      'Seen 4 times in 90 days'
    );
    expect(recurrenceHeadline({ occurrences: 101, capped: true, windowDays: 90 })).toBe(
      'Seen 101+ times in 90 days'
    );
  });
});

describe('evidence-filled draft', () => {
  it('returns the template draft unchanged when nothing is known', () => {
    expect(applyEvidenceToDraft(base, noEvidence)).toEqual(base);
  });

  it('writes confirmed causes, runbook outcomes, recurrence and similar fixes into the draft', () => {
    const evidence: PostmortemEvidence = {
      axis: [
        { kind: 'CHANGE', at: at('09:50'), title: 'Deploy api v42', detail: 'deploy · ci · API' },
        { kind: 'ALERT', at: at('10:01'), title: 'High error rate', detail: 'critical' },
        { kind: 'ALERT', at: at('10:02'), title: 'High error rate again', detail: null },
        { kind: 'NOISE_DECISION', at: at('10:03'), title: 'Suppressed', detail: null },
      ],
      changes: [
        {
          id: 'c1',
          kind: 'DEPLOY',
          summary: 'Deploy api v42',
          serviceName: 'API',
          leadMinutes: 10,
          accepted: true,
        },
        {
          id: 'c2',
          kind: 'CONFIG',
          summary: 'Raise pool size',
          serviceName: null,
          leadMinutes: 30,
          accepted: false,
        },
      ],
      upstreamIncidents: [],
      runbookRuns: [
        {
          id: 'r1',
          name: 'Roll back API',
          status: 'SUCCEEDED',
          at: at('10:20'),
          recoveryOutcome: 'RESOLVED',
        },
      ],
      similarFixes: [
        { incidentId: 'old-1', title: 'API errors after deploy', fix: 'Rolled back the release' },
      ],
      recurrence,
    };
    const draft = applyEvidenceToDraft(base, evidence, () => '10:20 UTC');

    expect(draft.summary).toBe(base.summary);
    expect(draft.rootCause).toBe(
      'Confirmed by responders during the incident:\n- Deploy "Deploy api v42" on API, 10 min before onset'
    );
    expect(draft.resolution).toBe(
      'Runbook "Roll back API" ran and succeeded at 10:20 UTC; recovery was verified.'
    );
    expect(draft.lessons).toContain('seen 4 times in 90 days');
    expect(draft.lessons).toContain('Last postmortem: "Disk full postmortem"');
    expect(draft.lessons).toContain('1 action item from earlier occurrences is still open');
    expect(draft.lessons).toContain('was fixed by: Rolled back the release');
    // Sorted by time; only the first alert; noise decisions are not postmortem timeline material.
    expect(draft.timeline.map(event => event.title)).toEqual([
      'Change: Deploy api v42',
      'Incident Started',
      'Alert: High error rate',
      'Runbook: Roll back API',
    ]);
    expect(draft.timeline.at(-1)?.type).toBe('MITIGATION');
  });

  it('labels unconfirmed causes as correlation only and keeps "to be determined"', () => {
    const draft = applyEvidenceToDraft(base, {
      ...noEvidence,
      changes: [
        {
          id: 'c2',
          kind: 'CONFIG',
          summary: 'Raise pool size',
          serviceName: null,
          leadMinutes: 0,
          accepted: false,
        },
      ],
      runbookRuns: [
        { id: 'r2', name: 'Restart', status: 'FAILED', at: null, recoveryOutcome: null },
      ],
    });
    expect(draft.rootCause).toMatch(/^To be determined\./);
    expect(draft.rootCause).toContain('correlation only, not a confirmed cause');
    expect(draft.rootCause).toContain('Configuration change "Raise pool size", at onset');
    expect(draft.resolution).toBe('Runbook "Restart" was tried and did not succeed.');
    expect(draft.lessons).toBe(base.lessons);
  });
});

describe('action-item suggestions', () => {
  const evidence: PostmortemEvidence = {
    ...noEvidence,
    changes: [
      {
        id: 'c1',
        kind: 'DEPLOY',
        summary: 'Deploy api v42',
        serviceName: 'API',
        leadMinutes: 10,
        accepted: true,
      },
      {
        id: 'c2',
        kind: 'CONFIG',
        summary: 'Not confirmed',
        serviceName: 'API',
        leadMinutes: 5,
        accepted: false,
      },
    ],
    upstreamIncidents: [
      {
        incidentId: 'up-1',
        title: 'Database failover',
        serviceName: 'Postgres',
        leadMinutes: 3,
        accepted: true,
      },
    ],
    runbookRuns: [
      { id: 'r1', name: 'Restart workers', status: 'FAILED', at: null, recoveryOutcome: null },
    ],
    similarFixes: [{ incidentId: 'old-1', title: 'API errors', fix: 'Rolled back the release' }],
  };

  it('proposes follow-ups only from confirmed causes, failed runbooks and known fixes', () => {
    const suggestions = suggestActionItems(evidence, []);
    expect(suggestions.map(item => [item.source, item.title, item.priority])).toEqual([
      ['ACCEPTED_CAUSE', 'Add a pre-release check or canary for API', 'HIGH'],
      ['ACCEPTED_CAUSE', 'Add a safeguard for failures of Postgres', 'HIGH'],
      ['RUNBOOK', 'Fix runbook "Restart workers"', 'MEDIUM'],
      ['SIMILAR_FIX', 'Make the known fix permanent: Rolled back the release', 'MEDIUM'],
    ]);
    expect(suggestions.every(item => item.duplicateOf === null)).toBe(true);
    expect(suggestActionItems(noEvidence, [])).toEqual([]);
  });

  it('points at the open action item that already covers a suggestion', () => {
    const existing = [
      { id: 'ai-9', title: 'Add canary and pre-release check for the API', incidentId: 'inc-3' },
      { id: 'ai-10', title: 'Rotate certificates' },
    ];
    const suggestions = suggestActionItems(evidence, existing);
    expect(suggestions[0].duplicateOf).toEqual(existing[0]);
    expect(suggestions[1].duplicateOf).toBeNull();
  });

  it('never proposes the same follow-up twice and caps the list', () => {
    const many = suggestActionItems(
      {
        ...noEvidence,
        changes: Array.from({ length: 8 }, (_, index) => ({
          id: `c${index}`,
          kind: 'DEPLOY',
          summary: `Deploy ${index}`,
          serviceName: index < 4 ? 'API' : `Service ${index}`,
          leadMinutes: 1,
          accepted: true,
        })),
      },
      []
    );
    expect(many).toHaveLength(5);
    expect(new Set(many.map(item => item.title)).size).toBe(5);
  });

  it('detects duplicates by word overlap, not by unrelated shared words', () => {
    const open = [
      { title: 'Add log rotation to the batch hosts' },
      { title: 'Write runbook for cache flush' },
    ];
    expect(findDuplicateActionItem('Batch hosts: add log rotation', open)).toBe(open[0]);
    expect(findDuplicateActionItem('add log rotation to batch hosts in eu-west', open)).toBe(
      open[0]
    );
    expect(findDuplicateActionItem('Add alert for disk usage on batch hosts', open)).toBeNull();
    expect(findDuplicateActionItem('', open)).toBeNull();
  });
});

describe('quality checklist', () => {
  const window = { start: at('10:00'), end: at('12:00') };
  const complete = {
    rootCause: 'The connection pool was exhausted by a retry storm.',
    actionItems: [{ owner: 'u1', dueDate: '2026-12-01', status: 'OPEN' }],
    timeline: ['10:05', '10:30', '10:55', '11:20', '11:45'].map(time => ({
      timestamp: at(time).toISOString(),
    })),
    window,
  };

  it('has nothing to say about a complete postmortem', () => {
    expect(checkPostmortemQuality(complete)).toEqual([]);
  });

  it('flags a missing or placeholder root cause and missing action items', () => {
    const codes = (input: Parameters<typeof checkPostmortemQuality>[0]) =>
      checkPostmortemQuality(input).map(issue => issue.code);
    expect(codes({ ...complete, rootCause: '  ' })).toEqual(['MISSING_ROOT_CAUSE']);
    expect(
      codes({ ...complete, rootCause: 'To be determined. Preliminary analysis suggests...' })
    ).toEqual(['MISSING_ROOT_CAUSE']);
    expect(codes({ ...complete, actionItems: [] })).toEqual(['NO_ACTION_ITEMS']);
  });

  it('counts open action items without an owner or due date and ignores completed ones', () => {
    const issues = checkPostmortemQuality({
      ...complete,
      actionItems: [
        { status: 'OPEN' },
        { owner: 'u1', status: 'IN_PROGRESS' },
        { status: 'COMPLETED' },
      ],
    });
    expect(issues).toEqual([
      { code: 'ACTION_ITEMS_WITHOUT_OWNER', message: '1 open action item has no owner.' },
      { code: 'ACTION_ITEMS_WITHOUT_DUE_DATE', message: '2 open action items have no due date.' },
    ]);
  });

  it('finds timeline gaps over 30 minutes inside the incident only', () => {
    const timeline = [
      { timestamp: at('09:00').toISOString() }, // before the incident: ignored
      { timestamp: at('10:10').toISOString() },
      { timestamp: at('11:15').toISOString() },
      { timestamp: 'not a date' },
    ];
    expect(timelineGaps(timeline, window).map(gap => gap.minutes)).toEqual([65, 45]);
    expect(checkPostmortemQuality({ ...complete, timeline })).toEqual([
      {
        code: 'TIMELINE_GAP',
        message:
          'The timeline has 2 gaps longer than 30 minutes while the incident was open (longest 65 min).',
      },
    ]);
    // Exactly 30 minutes is not a gap; an unresolved incident or no window is not checked.
    expect(timelineGaps([], { start: at('10:00'), end: at('10:30') })).toEqual([]);
    expect(timelineGaps([], { start: at('10:00'), end: null })).toEqual([]);
    expect(checkPostmortemQuality({ ...complete, timeline: [], window: null })).toEqual([]);
  });
});

describe('postmortem knowledge body', () => {
  const postmortem = {
    summary: 'API was down.',
    rootCause: 'Pool exhausted.',
    resolution: 'Rolled back.',
    lessons: 'Canary first.',
  };

  it('is unchanged without the extra sections', () => {
    expect(postmortemKnowledgeBody(postmortem)).toBe(
      'Summary: API was down.\n\nRoot cause: Pool exhausted.\n\nResolution: Rolled back.\n\nLessons: Canary first.'
    );
    expect(
      postmortemKnowledgeBody({ ...postmortem, timeline: null, fiveWhys: 'junk', actionItems: [] })
    ).toBe(postmortemKnowledgeBody(postmortem));
  });

  it('adds a bounded timeline summary, five whys and action items after the narrative', () => {
    const body = postmortemKnowledgeBody({
      ...postmortem,
      timeline: [
        { timestamp: '2026-11-10T10:00:00.000Z', type: 'DETECTION', title: 'Alert fired' },
        { timestamp: '2026-11-10T10:20:00.000Z', type: 'RESOLUTION', title: 'Rolled back' },
        { nonsense: true },
      ],
      fiveWhys: [
        { question: 'Why did the pool fill?', answer: 'Retries were unbounded.' },
        { question: '', answer: '' },
      ],
      actionItems: [
        { title: 'Bound retries', status: 'OPEN', priority: 'HIGH' },
        { title: 'Add canary', status: 'COMPLETED' },
        { title: '' },
      ],
    });
    expect(body.startsWith(postmortemKnowledgeBody(postmortem))).toBe(true);
    expect(body).toContain(
      'Timeline:\n2026-11-10 10:00 detection: Alert fired\n2026-11-10 10:20 resolution: Rolled back'
    );
    expect(body).toContain('Five whys:\nWhy did the pool fill? Retries were unbounded.');
    expect(body).toContain('Action items:\nBound retries (open)\nAdd canary (completed)');
  });

  it('bounds each extra section', () => {
    const body = postmortemKnowledgeBody({
      ...postmortem,
      timeline: Array.from({ length: 50 }, (_, index) => ({
        timestamp: '2026-11-10T10:00:00.000Z',
        type: 'DETECTION',
        title: `Event ${index} ${'x'.repeat(500)}`,
      })),
      actionItems: Array.from({ length: 50 }, (_, index) => ({ title: `Item ${index}` })),
    });
    expect(body.match(/detection:/g)).toHaveLength(12);
    expect(body.match(/Item \d+/g)).toHaveLength(10);
    expect(body.length).toBeLessThan(4_000);
  });
});
