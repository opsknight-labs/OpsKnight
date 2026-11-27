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

  it('returns password hash compatibility guidance for the 2.3 upgrade', async () => {
    const hits = await searchProductDocs('password hashes remain compatible bcryptjs upgrade');
    const upgrade = hits.find(hit => hit.url.includes('/upgrades/upgrade-to-2.3.0/'));
    expect(upgrade?.heading).toBe('Password hashes remain compatible');
    expect(upgrade?.text).toContain('bcryptjs');
    expect(upgrade?.text).toContain('72');
  });

  it('stems and drops stop words', () => {
    expect(docsTerms('How do I configure the escalations?')).toEqual(['configure', 'escalation']);
  });

  it('maps singular and plural to one stem', () => {
    const pairs = [
      ['services', 'service'],
      ['notes', 'note'],
      ['pages', 'page'],
      ['statuses', 'status'],
      ['policies', 'policy'],
      ['boxes', 'box'],
    ];
    for (const [plural, singular] of pairs) expect(docsTerms(plural)).toEqual(docsTerms(singular));
    expect(docsTerms('status access redis')).toEqual(['status', 'access', 'redis']);
  });

  it('does not answer from two common words that only brush a section', async () => {
    expect(await searchProductDocs('pizza delivery status')).toEqual([]);
    expect(await searchProductDocs('random words incident blah')).toEqual([]);
    expect((await searchProductDocs('set up status pages')).length).toBeGreaterThan(0);
  });
});
