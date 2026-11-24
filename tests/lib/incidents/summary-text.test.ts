import { describe, expect, it } from 'vitest';
import { incidentSummaryText } from '@/lib/incidents/summary-text';

describe('incident summary text', () => {
  it('is a short paste-ready summary', () => {
    expect(
      incidentSummaryText({
        title: 'Checkout API: card authorization timeouts',
        priority: 'P1',
        status: 'OPEN',
        serviceName: 'Checkout API',
        assigneeName: 'Miles Garcia',
        createdAt: new Date('2026-11-22T15:27:00Z'),
        now: new Date('2026-11-23T16:40:00Z'),
        alertTotal: 6,
        escalation: 'Max step reached',
        url: 'https://ops.example.com/incidents/abc',
      })
    ).toBe(
      [
        '*[P1] Checkout API: card authorization timeouts*',
        'Open · open 1d 1h · Checkout API',
        'Assignee: Miles Garcia · Escalation: Max step reached · 6 alerts',
        'https://ops.example.com/incidents/abc',
      ].join('\n')
    );
  });
});
