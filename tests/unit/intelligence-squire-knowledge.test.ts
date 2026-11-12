// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  blendKnowledgeScore,
  buildChunks,
  chunkKnowledgeText,
  cleanKnowledgeText,
  knowledgeContentHash,
  knowledgeTsQuery,
  postmortemKnowledgeBody,
  readRunbookSteps,
  runbookStepChunks,
  validateServiceFact,
} from '@/lib/intelligence/memory/contract';
import {
  aiInputsVisible,
  briefingContentSchema,
  buildBriefing,
  buildNudge,
  buildPostmortemDraft,
  filterProactiveRefs,
  nudgeContentSchema,
  postmortemDraftContentSchema,
  proactiveModelBrief,
  suggestNextSteps,
  type IncidentFacts,
  type ProactiveRefs,
} from '@/lib/intelligence/memory/proactive-content';
import { parseProactiveSubject, proactiveSubject } from '@/lib/intelligence/memory/proactive';

describe('knowledge chunking', () => {
  it('is deterministic, bounded and splits at paragraph, sentence and word boundaries', () => {
    const paragraph = 'The cache warmed slowly. '.repeat(60);
    const text = `${paragraph}\n\n${'Second part. '.repeat(10)}`;
    const first = chunkKnowledgeText(text, { chunkChars: 200, maxChunks: 4 });
    expect(first).toEqual(chunkKnowledgeText(text, { chunkChars: 200, maxChunks: 4 }));
    expect(first).toHaveLength(4);
    for (const chunk of first) expect(chunk.length).toBeLessThanOrEqual(200);
    // A single word longer than a chunk is cut, never dropped.
    expect(chunkKnowledgeText('x'.repeat(450), { chunkChars: 200 })).toEqual([
      'x'.repeat(200),
      'x'.repeat(200),
      'x'.repeat(50),
    ]);
    expect(chunkKnowledgeText('   ')).toEqual([]);
  });

  it('never stores credentials: every chunk is redacted before hashing', () => {
    const chunks = buildChunks(
      'DB failover',
      'Restarted with password=hunter2hunter2 and token sk-abcdefghijklmnopqrstuvwxyz123456'
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).not.toMatch(/hunter2|sk-abc/);
    expect(chunks[0].text).toContain('[redacted]');
    expect(chunks[0].contentHash).toBe(knowledgeContentHash(chunks[0].title, chunks[0].text));
    expect(cleanKnowledgeText('Bearer abcdefghijklmnopqrstuvwxyz')).toBe('[redacted]');
  });

  it('changes the content hash only when the text changes', () => {
    const a = buildChunks('T', 'same body');
    const b = buildChunks('T', 'same   body');
    const c = buildChunks('T', 'other body');
    expect(a[0].contentHash).toBe(b[0].contentHash);
    expect(a[0].contentHash).not.toBe(c[0].contentHash);
  });

  it('indexes postmortem sections and runbook step names, never step configuration', () => {
    expect(
      postmortemKnowledgeBody({ summary: 'S', rootCause: null, resolution: 'R', lessons: '' })
    ).toBe('Summary: S\n\nResolution: R');
    const steps = readRunbookSteps({
      steps: [
        { name: 'Drain node', description: 'Cordon first', config: { command: 'kubectl drain' } },
        { name: '' },
        'garbage',
        { name: 'Restart', config: { secret: 'x' } },
      ],
    });
    expect(steps).toEqual([
      { name: 'Drain node', description: 'Cordon first' },
      { name: 'Restart', description: null },
    ]);
    const chunks = runbookStepChunks('Recover DB', steps);
    expect(chunks.map(chunk => chunk.title)).toEqual(['Recover DB: step 1', 'Recover DB: step 2']);
    expect(JSON.stringify(chunks)).not.toContain('kubectl');
    expect(readRunbookSteps(null)).toEqual([]);
  });

  it('builds an OR query of distinct words and drops stop words and symbols', () => {
    expect(knowledgeTsQuery('How did we fix the payments-db failover?')).toBe(
      'fix | payments | db | failover'
    );
    expect(knowledgeTsQuery("'; DROP TABLE x; --")).toBe('drop | table');
    expect(knowledgeTsQuery('the a of')).toBeNull();
  });

  it('blends lexical and semantic scores only when a semantic score exists', () => {
    expect(blendKnowledgeScore(0.5, null)).toBe(0.5);
    expect(blendKnowledgeScore(1, 0)).toBeCloseTo(0.4);
    expect(blendKnowledgeScore(2, 2)).toBe(1);
  });

  it('accepts short plain facts and refuses credentials instead of storing them redacted', () => {
    expect(validateServiceFact('Failover takes about 4 minutes; wait before restarting.')).toEqual({
      ok: true,
      fact: 'Failover takes about 4 minutes; wait before restarting.',
    });
    expect(validateServiceFact('too short')).toMatchObject({ ok: false });
    expect(validateServiceFact('x'.repeat(501))).toMatchObject({ ok: false });
    expect(validateServiceFact('The admin password=supersecret123 works')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/secret/),
    });
  });
});

const facts: IncidentFacts = {
  id: 'inc1',
  title: 'Checkout latency high',
  serviceName: 'checkout',
  status: 'OPEN',
  urgency: 'HIGH',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  acknowledgedAt: null,
  resolvedAt: null,
  alertCount: 3,
  resolutionNote: null,
  events: [{ at: new Date('2026-11-08T10:00:00Z'), text: 'Incident triggered' }],
};
const refs: ProactiveRefs = {
  similar: [{ id: 'old1', label: 'Checkout slow', matchPercent: 82, resolution: 'Scaled pods' }],
  changes: [{ id: 'chg1', label: 'Deploy checkout v42', minutesBefore: 7 }],
  runbooks: [{ id: 'rb1', label: 'Scale checkout', succeeded: 4, eligible: 5 }],
};

describe('proactive content', () => {
  it('writes a deterministic briefing that only describes the incident itself in free text', () => {
    const briefing = buildBriefing(facts, refs, {
      now: new Date('2026-11-08T10:12:00Z'),
      analysisPending: false,
    });
    expect(briefingContentSchema.safeParse(briefing).success).toBe(true);
    expect(briefing.headline).toBe('Checkout latency high (checkout)');
    expect(briefing.facts[0]).toMatch(/Opened 12 min ago with high urgency; 3 alerts/);
    expect(briefing.facts[1]).toBe('Not acknowledged yet.');
    // Other records appear only as references, which the page filters per viewer.
    expect(JSON.stringify([briefing.headline, briefing.facts])).not.toMatch(/Deploy|Scale|slow/);
  });

  it('suggests next steps only from references the viewer may see', () => {
    expect(suggestNextSteps(refs)).toEqual([
      'Review the runbook “Scale checkout” (it resolved 4 of 5 similar runs).',
      'Check the change “Deploy checkout v42”, recorded 7 min before this incident began; consider rolling it back if it matches.',
      'A similar incident was resolved with: Scaled pods',
      'Confirm customer impact and post a stakeholder update.',
    ]);
    const hidden = filterProactiveRefs(refs, {
      incidents: new Set(),
      changes: new Set(),
      runbooks: new Set(),
    });
    expect(suggestNextSteps(hidden)).toEqual([
      'Confirm customer impact and post a stakeholder update.',
    ]);
  });

  it('shows AI text only when every record the model saw is visible', () => {
    const inputs = { incidents: ['old1'], changes: ['chg1'], runbooks: [] };
    const all = {
      incidents: new Set(['old1']),
      changes: new Set(['chg1']),
      runbooks: new Set<string>(),
    };
    expect(aiInputsVisible(inputs, all)).toBe(true);
    expect(aiInputsVisible(inputs, { ...all, incidents: new Set<string>() })).toBe(false);
  });

  it('drafts a stakeholder update and a postmortem without publishing anything', () => {
    const nudge = buildNudge(facts, {
      now: new Date('2026-11-08T10:45:00Z'),
      lastUpdateAt: new Date('2026-11-08T10:05:00Z'),
      thresholdMinutes: 30,
    });
    expect(nudgeContentSchema.safeParse(nudge).success).toBe(true);
    expect(nudge.minutesSinceUpdate).toBe(40);
    expect(nudge.draft).toMatch(/affecting checkout: Checkout latency high/);

    const draft = buildPostmortemDraft(
      {
        ...facts,
        status: 'RESOLVED',
        acknowledgedAt: new Date('2026-11-08T10:30:00Z'),
        resolvedAt: new Date('2026-11-08T11:30:00Z'),
        resolutionNote: 'Rolled back v42',
      },
      refs
    );
    expect(postmortemDraftContentSchema.safeParse(draft).success).toBe(true);
    expect(draft.summary).toMatch(/for 1 h 30 min/);
    expect(draft.resolution).toBe('Rolled back v42');
    expect(draft.rootCause).toMatch(/Not yet confirmed/);
    expect(draft.actionItems.map(item => item.title)).toContain(
      'Review why acknowledgement took longer than 15 minutes'
    );
  });

  it('gives the model a redacted brief marked as correlation, not cause', () => {
    const brief = proactiveModelBrief(
      { ...facts, resolutionNote: 'used token=abcdefabcdef123' },
      refs
    );
    expect(brief).toMatch(/correlation only, not confirmed causes/);
    expect(brief).not.toContain('abcdefabcdef123');
  });

  it('round-trips work subjects and refuses anything else', () => {
    expect(parseProactiveSubject(proactiveSubject('BRIEFING', 'abc_1'))).toEqual({
      kind: 'BRIEFING',
      incidentId: 'abc_1',
    });
    expect(parseProactiveSubject('BRIEFING:')).toBeNull();
    expect(parseProactiveSubject('OTHER:abc')).toBeNull();
    expect(parseProactiveSubject('BRIEFING:a b')).toBeNull();
  });
});
