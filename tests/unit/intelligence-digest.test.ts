import { describe, expect, it } from 'vitest';
import {
  digestScheduledFor,
  isDigestDue,
  isoWeekKey,
  isoWeekStart,
} from '@/lib/intelligence/digest/contract';
import { escapeHtml, renderDigestEmail } from '@/lib/intelligence/digest/render';
import { teamBriefLine } from '@/lib/intelligence/digest/team-brief';

describe('digest schedule', () => {
  it('computes ISO week keys, including year boundaries', () => {
    expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(isoWeekKey(new Date('2026-06-15T23:59:59Z'))).toBe('2026-W25');
    expect(isoWeekStart(new Date('2026-06-21T23:00:00Z')).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z'
    );
  });

  it('is due from the configured day and hour until the end of that week', () => {
    const schedule = { enabled: true, dayOfWeek: 3, hourUtc: 9 };
    expect(digestScheduledFor(new Date('2026-06-15T00:00:00Z'), schedule).toISOString()).toBe(
      '2026-06-17T09:00:00.000Z'
    );
    expect(isDigestDue(new Date('2026-06-17T08:59:00Z'), schedule)).toBe(false);
    expect(isDigestDue(new Date('2026-06-17T09:00:00Z'), schedule)).toBe(true);
    expect(isDigestDue(new Date('2026-06-21T23:00:00Z'), schedule)).toBe(true);
    // A new week starts over: nothing is carried forward.
    expect(isDigestDue(new Date('2026-06-22T00:30:00Z'), schedule)).toBe(false);
    expect(isDigestDue(new Date('2026-06-18T00:00:00Z'), { ...schedule, enabled: false })).toBe(
      false
    );
  });

  it('treats Sunday as the last day of the ISO week', () => {
    const sunday = { enabled: true, dayOfWeek: 0, hourUtc: 18 };
    expect(digestScheduledFor(new Date('2026-06-16T00:00:00Z'), sunday).toISOString()).toBe(
      '2026-06-21T18:00:00.000Z'
    );
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
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
    );
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
      insightsUrl: 'https://ops.example.com/settings/intelligence/evaluation#insights',
      settingsUrl: 'https://ops.example.com/settings/intelligence/evaluation#digest',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('disk &quot;full&quot; on &lt;num&gt;');
    expect(email.text).toContain('Possible causes found: 3');
    expect(email.text).toContain('75% (4 ratings)');
    expect(email.subject).toContain('2026-W25');
    expect(email.html).toContain('never changes incidents or paging');
  });
  it('lists open operations insights, escaped, and hides the section when there are none', () => {
    const base = {
      weekKey: '2026-W25',
      weekly,
      recurring: [],
      anomalies: [],
      insightsUrl: 'https://ops.example.com/settings/intelligence/insights',
      settingsUrl: 'https://ops.example.com/settings/intelligence/insights#digest',
    };
    expect(renderDigestEmail(base).html).not.toContain('Needs attention');
    expect(renderDigestEmail({ ...base, opsInsights: [] }).text).not.toContain('Needs attention');
    const email = renderDigestEmail({
      ...base,
      opsInsights: Array.from({ length: 7 }, (_, n) => ({
        scopeName: `<b>svc-${n}</b>`,
        title: 'No alerts for 3 days',
        severity: n === 0 ? 'CRITICAL' : 'INFO',
        url: `https://ops.example.com/services/s${n}`,
      })),
      opsInsightsUrl: 'https://ops.example.com/intelligence',
    });
    expect(email.text).toContain(
      '- <b>svc-0</b>: No alerts for 3 days [critical] https://ops.example.com/services/s0'
    );
    expect(email.text).toContain('- <b>svc-1</b>: No alerts for 3 days https://');
    expect(email.text).not.toContain('svc-5');
    expect(email.html).toContain('&lt;b&gt;svc-0&lt;/b&gt;</a>: No alerts for 3 days [critical]');
    expect(email.html).not.toContain('<b>svc');
    expect(email.html).toContain('href="https://ops.example.com/intelligence"');
  });

  it('adds a brief per team, escaped, with the team page link, and nothing when there are none', () => {
    const base = {
      weekKey: '2026-W25',
      weekly,
      recurring: [],
      anomalies: [],
      insightsUrl: 'https://ops.example.com/i',
      settingsUrl: 'https://ops.example.com/s',
    };
    const without = renderDigestEmail(base);
    expect(renderDigestEmail({ ...base, teamBriefs: [] })).toEqual(without);
    const email = renderDigestEmail({
      ...base,
      teamBriefs: [
        {
          teamName: '<i>Payments</i>',
          url: 'https://ops.example.com/teams/t1',
          line: teamBriefLine({ incidents: 4, previousIncidents: 1, open: { WARNING: 1 } }),
          phrasing: 'A calmer week.',
          insights: [
            {
              scopeName: 'API',
              title: 'Step 1 is never acknowledged',
              severity: 'WARNING',
              url: 'https://ops.example.com/policies/p1',
            },
          ],
        },
      ],
    });
    expect(email.text).toContain(
      '<i>Payments</i>: 4 incidents in the last 7 days (1 the week before); 1 open insight (1 warning).'
    );
    expect(email.text).toContain('A calmer week.');
    expect(email.text).toContain('Team page: https://ops.example.com/teams/t1');
    expect(email.html).toContain('href="https://ops.example.com/teams/t1"');
    expect(email.html).toContain('&lt;i&gt;Payments&lt;/i&gt;');
    expect(email.html).not.toContain('<i>Payments');
  });

  it('states a team week deterministically', () => {
    expect(teamBriefLine({ incidents: 1, previousIncidents: 0, open: {} })).toBe(
      '1 incident in the last 7 days (0 the week before); no open insights.'
    );
    expect(
      teamBriefLine({ incidents: 0, previousIncidents: 3, open: { INFO: 2, CRITICAL: 1 } })
    ).toBe(
      '0 incidents in the last 7 days (3 the week before); 3 open insights (1 critical, 2 info).'
    );
  });
});
