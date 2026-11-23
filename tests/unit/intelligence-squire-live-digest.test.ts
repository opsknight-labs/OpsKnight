import { describe, expect, it } from 'vitest';
import {
  renderDiagnosis,
  type EvidenceEntry,
} from '@/lib/intelligence/squire/investigation/engine';
import {
  diffDiagnoses,
  digestIsEmpty,
  digestMarkdown,
  parseDiagnosis,
} from '@/lib/intelligence/memory/proactive-digest';
import {
  nextInvestigationContent,
  reassessmentsToday,
  signalLines,
  withAttempt,
} from '@/lib/intelligence/memory/proactive-live';
import { investigationContentSchema } from '@/lib/intelligence/memory/proactive-content';
import { PROACTIVE_LIMITS } from '@/lib/intelligence/memory/contract';

const ledger: EvidenceEntry[] = [
  { handle: 'E1', kind: 'change', id: 'chg-1', label: 'Release 42', href: '/changes/chg-1' },
  { handle: 'E2', kind: 'metric', id: 'm-1', label: 'Cache hit rate', href: '/metrics/m-1' },
];

type Hypothesis = {
  title: string;
  confidence: number;
  support?: 'supported' | 'contradicted';
  evidence?: string[];
};
const render = (hypotheses: Hypothesis[], nextChecks: string[]) =>
  renderDiagnosis(
    {
      summary: 'Summary.',
      hypotheses: hypotheses.map(h => ({
        explanation: 'Because.',
        support: 'supported',
        evidence: ['E1'],
        ...h,
      })),
      nextChecks,
    } as Parameters<typeof renderDiagnosis>[0],
    ledger,
    { steps: 2, reads: 3 }
  ).text;

const first = render(
  [
    { title: 'Release 42 introduced the errors', confidence: 0.7 },
    { title: 'Database saturation', confidence: 0.45 },
    { title: 'Upstream DNS', confidence: 0.4 },
  ],
  ['Compare error rates before and after release 42']
);

describe('parseDiagnosis', () => {
  it('reads hypotheses, ruled-out titles and next checks back from the rendered markdown', () => {
    const parsed = parseDiagnosis(
      render(
        [
          { title: 'Release 42 introduced the errors', confidence: 0.7 },
          { title: 'Upstream DNS', confidence: 0.3, support: 'contradicted' },
        ],
        ['Roll back 42']
      )
    );
    expect(parsed).toEqual({
      hypotheses: [{ title: 'Release 42 introduced the errors', confidence: 70 }],
      ruledOut: ['Upstream DNS'],
      nextChecks: ['Roll back 42'],
    });
  });
});

describe('diffDiagnoses', () => {
  it('reports the new leader, moves of 10 points or more, newly ruled out, dropped and new checks', () => {
    const second = render(
      [
        { title: 'Cache eviction storm', confidence: 0.8, evidence: ['E2'] },
        { title: 'release 42 introduced the errors', confidence: 0.4 },
        { title: 'Database saturation', confidence: 0.5 },
        { title: 'Upstream DNS', confidence: 0.1, support: 'contradicted' },
      ],
      ['Compare error rates before and after release 42', 'Check the cache hit rate']
    );
    expect(diffDiagnoses(parseDiagnosis(first), parseDiagnosis(second))).toEqual({
      leading: 'Cache eviction storm',
      added: ['Cache eviction storm (80%)'],
      up: [],
      // Matched case-insensitively; a 5-point move is noise.
      down: ['release 42 introduced the errors (70% → 40%)'],
      ruledOut: ['Upstream DNS'],
      dropped: [],
      nextChecks: ['Check the cache hit rate'],
    });
  });

  it('is empty when the conclusion did not move', () => {
    const diff = diffDiagnoses(parseDiagnosis(first), parseDiagnosis(first));
    expect(diff).toEqual({
      leading: null,
      added: [],
      up: [],
      down: [],
      ruledOut: [],
      dropped: [],
      nextChecks: [],
    });
  });
});

const content = (answer: string, sources: Array<{ kind: string; id: string }>) => ({
  v: 1 as const,
  answer,
  partial: false,
  teamId: 'team-1',
  sources,
  citations: sources.map(source => ({ ...source, label: source.id, href: `/${source.id}` })),
});

describe('nextInvestigationContent', () => {
  it('stores the new conclusion with a bounded digest history and the union of sources per digest', () => {
    const startedAt = new Date('2026-11-23T10:00:00Z');
    let previous = investigationContentSchema.parse({
      ...content(first, [{ kind: 'change', id: 'chg-1' }]),
      assessedAt: '2026-11-23T09:00:00Z',
      revision: 1,
    });
    const second = render(
      [{ title: 'Cache eviction storm', confidence: 0.8, evidence: ['E2'] }],
      ['Check the cache hit rate']
    );
    const signals = { alerts: 2, notes: 1, events: 0, changes: 1 };
    const { content: next, digest } = nextInvestigationContent(
      previous,
      content(second, [{ kind: 'metric', id: 'm-1' }]),
      { startedAt, signals }
    );
    expect(next.revision).toBe(2);
    expect(next.assessedAt).toBe(startedAt.toISOString());
    expect(next.reassessedAt).toEqual([startedAt.toISOString()]);
    expect(digest.signals).toEqual([
      '2 new alerts',
      '1 new note',
      '1 new deploy or change on the service',
    ]);
    expect(digest.leading).toBe('Cache eviction storm');
    expect(digest.dropped).toEqual([
      'Release 42 introduced the errors',
      'Database saturation',
      'Upstream DNS',
    ]);
    expect(digest.newEvidence.map(item => item.id)).toEqual(['m-1']);
    expect(digest.sources).toEqual([
      { kind: 'change', id: 'chg-1' },
      { kind: 'metric', id: 'm-1' },
    ]);
    expect(investigationContentSchema.safeParse(next).success).toBe(true);
    expect(digestMarkdown(digest)).toContain('**Leading hypothesis is now:** Cache eviction storm');

    // History stays bounded, newest first.
    for (let run = 0; run < PROACTIVE_LIMITS.maxDigests + 2; run += 1)
      previous = nextInvestigationContent(previous, content(second, []), {
        startedAt: new Date(startedAt.getTime() + (run + 1) * 600_000),
        signals,
      }).content;
    expect(previous.updates).toHaveLength(PROACTIVE_LIMITS.maxDigests);
    expect(previous.updates![0].revision).toBeGreaterThan(previous.updates![1].revision);
    expect(digestIsEmpty(previous.updates![0])).toBe(true);
    expect(digestMarkdown(previous.updates![0])).toContain('No change to the conclusion.');
    expect(investigationContentSchema.safeParse(previous).success).toBe(true);
  });

  it('caps the attempt log and counts only the last day', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    let base = investigationContentSchema.parse(content(first, []));
    for (let hour = 30; hour > 0; hour -= 1)
      base = {
        ...base,
        reassessedAt: withAttempt(base, new Date(now.getTime() - hour * 3_600_000)),
      };
    expect(base.reassessedAt).toHaveLength(PROACTIVE_LIMITS.reassessPerIncidentDaily);
    expect(reassessmentsToday(base, now)).toBe(PROACTIVE_LIMITS.reassessPerIncidentDaily);
    expect(reassessmentsToday(base, new Date(now.getTime() + 20 * 3_600_000))).toBe(
      PROACTIVE_LIMITS.reassessPerIncidentDaily - 9
    );
    expect(signalLines({ alerts: 0, notes: 0, events: 0, changes: 0 })).toEqual([]);
  });
});

describe('channel-safe investigation text', () => {
  it('keeps only the verdict, hypothesis titles with confidence, ruled-out titles and the incident link', async () => {
    const { channelSafeInvestigation } = await import('@/lib/intelligence/memory/proactive-digest');
    const answer = [
      '## Investigation',
      '**Result: inconclusive.** The evidence read so far does not establish a cause.',
      'Deploy 42 by Jane Payroll is the likely trigger; log line "password=hunter2".',
      '### Ranked hypotheses',
      '1. **Bad [deploy](https://evil.tld)** — confidence 80% (high, validated by system state)',
      '   Errors began after the deploy; log says "token leaked".',
      '   Evidence: [Deploy 42](/changes/c1), [Payroll outage](/incidents/other)',
      '### Ruled out',
      '- ~~DB saturation~~ — CPU stayed low. Evidence: [DB CPU](/alerts/a1)',
      '### Evidence read',
      '- Jane Doe (user)',
      '- prod-datadog (connection)',
      'See [this incident](/incidents/inc1?x><!channel>).',
    ].join('\n');
    const text = channelSafeInvestigation(answer, 'inc1');
    expect(text).toContain('Result: inconclusive.');
    expect(text).toContain('1. **Bad deploy** — confidence 80% (high, validated by system state)');
    expect(text).toContain('- DB saturation');
    expect(text).not.toMatch(
      /Payroll|hunter2|token leaked|CPU stayed low|Jane|prod-datadog|Evidence read|evil\.tld|\/changes\/|\/alerts\/|\/incidents\/other|<!channel>|Evidence:/
    );
    expect(text).toContain('[open the incident in OpsKnight](/incidents/inc1?insights=why)');
    expect(text.match(/\]\(/g)).toHaveLength(1);
  });

  it('reduces a partial investigation to its stop line', async () => {
    const { channelSafeInvestigation } = await import('@/lib/intelligence/memory/proactive-digest');
    const text = channelSafeInvestigation(
      [
        '## Investigation (partial)',
        'I stopped before reaching a conclusion because the request was cancelled. Here is what I checked.',
        '### What I checked',
        '- Step 1: Read logs (Search logs)',
        '### Evidence read',
        '- Jane Doe (user)',
      ].join('\n'),
      'inc 1'
    );
    expect(text).toContain('stopped before reaching a conclusion');
    expect(text).not.toMatch(/Jane|Step 1|cancelled/);
    expect(text).toContain('/incidents/inc%201?insights=why');
  });
});
