import { describe, expect, it } from 'vitest';
import { docsTerms, searchProductDocs } from '@/lib/intelligence/squire/docs';

describe('product docs search', () => {
  it.each([
    ['How do I add an on-call override?', '/guides/on-call/overrides/'],
    ['how to set up slack', 'slack'],
    ['create an escalation policy', 'escalation'],
    ['keep stakeholders informed during an incident', 'stakeholder'],
  ])('finds the guide for "%s"', async (question, fragment) => {
    const hits = await searchProductDocs(question);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.slice(0, 3).some(hit => hit.url.includes(fragment))).toBe(true);
    expect(hits[0].url).toMatch(/^https:\/\/opsknight\.com\/docs\/latest\//);
  });

  it('returns one section per page and nothing for an empty question', async () => {
    const hits = await searchProductDocs('schedule rotation override handoff', 3);
    expect(new Set(hits.map(hit => hit.url)).size).toBe(hits.length);
    expect(await searchProductDocs('how do I')).toEqual([]);
  });

  it('stems and drops stop words', () => {
    expect(docsTerms('How do I configure the escalations?')).toEqual(['configure', 'escalation']);
  });
});
