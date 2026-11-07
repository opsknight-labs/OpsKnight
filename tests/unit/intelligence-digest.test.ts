import { describe, expect, it } from 'vitest';
import { digestScheduledFor, isDigestDue, isoWeekKey, isoWeekStart } from '@/lib/intelligence/digest/contract';
import { escapeHtml, renderDigestEmail } from '@/lib/intelligence/digest/render';

describe('digest schedule', () => {
  it('computes ISO week keys, including year boundaries', () => {
    expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(isoWeekKey(new Date('2026-06-15T23:59:59Z'))).toBe('2026-W25');
    expect(isoWeekStart(new Date('2026-06-21T23:00:00Z')).toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('is due from the configured day and hour until the end of that week', () => {
    const schedule = { enabled: true, dayOfWeek: 3, hourUtc: 9 };
    expect(digestScheduledFor(new Date('2026-06-15T00:00:00Z'), schedule).toISOString()).toBe('2026-06-17T09:00:00.000Z');
    expect(isDigestDue(new Date('2026-06-17T08:59:00Z'), schedule)).toBe(false);
    expect(isDigestDue(new Date('2026-06-17T09:00:00Z'), schedule)).toBe(true);
    expect(isDigestDue(new Date('2026-06-21T23:00:00Z'), schedule)).toBe(true);
    // A new week starts over: nothing is carried forward.
    expect(isDigestDue(new Date('2026-06-22T00:30:00Z'), schedule)).toBe(false);
    expect(isDigestDue(new Date('2026-06-18T00:00:00Z'), { ...schedule, enabled: false })).toBe(false);
  });

  it('treats Sunday as the last day of the ISO week', () => {
    const sunday = { enabled: true, dayOfWeek: 0, hourUtc: 18 };
    expect(digestScheduledFor(new Date('2026-06-16T00:00:00Z'), sunday).toISOString()).toBe('2026-06-21T18:00:00.000Z');
  });
});

describe('digest email', () => {
  const weekly = {
    windowDays: 7,
    incidentsAnalyzed: 12,
    findingsByKind: { SIMILAR_INCIDENT: 4, PROBABLE_CAUSE: 1, CHANGE_CORRELATION: 2 },
    ratings: 4,
    helpfulRatings: 3,
    changesRecorded: 9,
    deadLetters: 0,
  };

  it('escapes every value that reaches HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    const email = renderDigestEmail({
      weekKey: '2026-W25',
      weekly,
      recurring: [
        {
          serviceId: 's',
          serviceName: '<script>alert(1)</script>',
          template: 'disk "full" on <num>',
          occurrences: 4,
          distinctDays: 3,
          lastSeenAt: new Date(),
          latestIncidentId: 'i',
          hasRunbook: false,
        },
      ],
      anomalies: [],
      insightsUrl: 'https://ops.example.com/settings/intelligence/insights',
      settingsUrl: 'https://ops.example.com/settings/intelligence/insights#digest',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('disk &quot;full&quot; on &lt;num&gt;');
    expect(email.text).toContain('Possible causes found: 3');
    expect(email.text).toContain('75% (4 ratings)');
    expect(email.subject).toContain('2026-W25');
    expect(email.html).toContain('never changes incidents or paging');
  });
});
