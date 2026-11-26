import { describe, expect, it } from 'vitest';
import {
  BusinessServiceLinkSchema,
  linksFromLines,
  linksToLines,
  parseBusinessServiceLinks,
} from '@/lib/business-services/links';

describe('business service links', () => {
  it('accepts https only', () => {
    expect(BusinessServiceLinkSchema.safeParse({ label: 'a', url: 'https://x.io/p' }).success).toBe(
      true
    );
    for (const url of ['http://x.io', 'javascript:alert(1)', 'not a url'])
      expect(BusinessServiceLinkSchema.safeParse({ label: 'a', url }).success).toBe(false);
  });

  it('round-trips form lines and rejects bad ones', () => {
    const links = linksFromLines('Runbook | https://x.io/r\n\nDash | https://x.io/d?a=1|2');
    expect(links).toHaveLength(2);
    expect(linksFromLines(linksToLines(links!))).toEqual(links);
    expect(linksFromLines('https://x.io/no-label')).toBeNull();
    expect(linksFromLines('A | http://x.io')).toBeNull();
    expect(
      linksFromLines(Array.from({ length: 11 }, () => 'A | https://x.io').join('\n'))
    ).toBeNull();
  });

  it('keeps the good links when one stored link is malformed', () => {
    const good = { label: 'Runbook', url: 'https://x.io/r' };
    expect(parseBusinessServiceLinks([good, { label: 'a', url: 'ftp://x' }, 7])).toEqual([good]);
  });

  it('drops malformed stored JSON', () => {
    expect(parseBusinessServiceLinks([{ label: 'a', url: 'ftp://x' }])).toEqual([]);
    expect(parseBusinessServiceLinks(null)).toEqual([]);
  });
});
