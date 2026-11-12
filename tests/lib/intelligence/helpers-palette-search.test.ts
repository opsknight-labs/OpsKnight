import { describe, expect, it } from 'vitest';
import {
  paletteKnowledgeHits,
  paletteKnowledgeQuery,
} from '@/lib/intelligence/helpers/palette-search';

describe('palette knowledge query', () => {
  it('sends phrases and questions, not name lookups', () => {
    expect(paletteKnowledgeQuery('db')).toBeNull();
    expect(paletteKnowledgeQuery('checkout api')).toBeNull();
    expect(paletteKnowledgeQuery('INC-1234 5 6')).toBeNull();
    expect(paletteKnowledgeQuery('  why did   checkout fail ')).toBe('why did checkout fail');
  });

  it('caps the query length', () => {
    expect(paletteKnowledgeQuery('word '.repeat(100))!.length).toBeLessThanOrEqual(200);
  });
});

describe('palette knowledge hits', () => {
  const item = (kind: string, href: string, text = 'restart the pods') => ({
    title: `${kind} ${href}`,
    text,
    source: { kind, href },
  });

  it('keeps one row per source, best first, and drops service facts', () => {
    const hits = paletteKnowledgeHits([
      item('runbook', '/runbooks/r1', 'first passage'),
      item('service', '/services/s1'),
      item('runbook', '/runbooks/r1', 'second passage'),
      item('postmortem', '/postmortems/i1'),
      item('incident', '/incidents/i2'),
    ]);
    expect(hits.map(hit => hit.href)).toEqual(['/runbooks/r1', '/postmortems/i1', '/incidents/i2']);
    expect(hits[0].snippet).toBe('first passage');
  });

  it('shows at most five and shortens long passages', () => {
    const hits = paletteKnowledgeHits(
      Array.from({ length: 8 }, (_, i) => item('incident', `/incidents/${i}`, 'x '.repeat(200)))
    );
    expect(hits).toHaveLength(5);
    expect(hits[0].snippet.length).toBeLessThanOrEqual(140);
    expect(hits[0].snippet.endsWith('…')).toBe(true);
  });
});
