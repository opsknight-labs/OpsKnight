import { describe, it, expect } from 'vitest';
import {
  generateIncidentEmailHTML,
  generateShiftReminderEmailHTML,
  generateShiftHandoffEmailHTML,
} from '@/lib/email';

describe('Dynamic Colorful Incident Email Templates', () => {
  const baseIncident = {
    id: 'inc-12345',
    title: 'Payment Gateway Connection Timeout',
    description: 'PostgreSQL connection pool exhausted on ap-south-1 cluster.',
    status: 'TRIGGERED',
    urgency: 'HIGH',
    service: { name: 'Checkout & Payments' },
    assignee: { name: 'Alex Rivera', email: 'alex@example.com' },
    createdAt: new Date('2026-09-05T10:00:00Z'),
    incidentUrl: 'https://opsknight.com/incidents/inc-12345',
  };

  it('generates a vivid Crimson Red template for Critical / HIGH urgency incidents', () => {
    const html = generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    // Header gradient should be Crimson / Rose
    expect(html).toContain('linear-gradient(135deg, #881337 0%, #be123c 45%, #e11d48 100%)');
    // Button should be red
    expect(html).toContain('linear-gradient(135deg, #be123c 0%, #e11d48 100%)');
    // Badge should be error type
    expect(html).toContain('CRITICAL INCIDENT');
    // Contains incident title and service name
    expect(html).toContain('Payment Gateway Connection Timeout');
    expect(html).toContain('Checkout &amp; Payments');
    // Contains CTA button
    expect(html).toContain('View Incident');
    expect(html).toContain('https://opsknight.com/incidents/inc-12345');
  });

  it('generates an Amber / Orange template for Elevated / MEDIUM urgency incidents', () => {
    const mediumIncident = {
      ...baseIncident,
      urgency: 'MEDIUM',
    };
    const html = generateIncidentEmailHTML(mediumIncident, 'UTC', 'triggered');

    expect(html).toContain('linear-gradient(135deg, #78350f 0%, #b45309 45%, #d97706 100%)');
    expect(html).toContain('linear-gradient(135deg, #b45309 0%, #d97706 100%)');
    expect(html).toContain('ELEVATED INCIDENT');
  });

  it('generates an Emerald Green template for Resolved incidents', () => {
    const resolvedIncident = {
      ...baseIncident,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-05T10:30:00Z'),
    };
    const html = generateIncidentEmailHTML(resolvedIncident, 'UTC', 'resolved');

    expect(html).toContain('linear-gradient(135deg, #064e3b 0%, #047857 45%, #059669 100%)');
    expect(html).toContain('linear-gradient(135deg, #047857 0%, #059669 100%)');
    expect(html).toContain('RESOLVED');
    expect(html).toContain('View Resolution');
  });

  it('generates an Amber template for Acknowledged incidents', () => {
    const ackIncident = {
      ...baseIncident,
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date('2026-09-05T10:05:00Z'),
    };
    const html = generateIncidentEmailHTML(ackIncident, 'UTC', 'acknowledged');

    expect(html).toContain('linear-gradient(135deg, #78350f 0%, #b45309 45%, #d97706 100%)');
    expect(html).toContain('ACKNOWLEDGED');
  });

  it('generates a Cobalt Blue template for Low urgency / updated incidents', () => {
    const lowIncident = {
      ...baseIncident,
      urgency: 'LOW',
    };
    const html = generateIncidentEmailHTML(lowIncident, 'UTC', 'updated');

    expect(html).toContain('linear-gradient(135deg, #1e3a8a 0%, #2563eb 45%, #3b82f6 100%)');
    expect(html).toContain('UPDATED');
  });

  it('renders a dynamic fluid container with responsive viewport and styling', () => {
    const html = generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    // Fluid container with max-width 640px
    expect(html).toContain('max-width: 640px');
    expect(html).toContain('viewport');
    expect(html).toContain('mobile-container');
    expect(html).toContain('mobile-outer-padding');
    expect(html).toContain('mobile-table-cell');
    expect(html).toContain('mobile-table-label');
  });

  it('renders a dedicated Incident Description card instead of unstyled Overview header', () => {
    const html = generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    // Must NOT contain ambiguous unstyled Overview heading
    expect(html).not.toContain('<h3 style="font-size:14px">Overview</h3>');
    // Must contain structured Incident Description header
    expect(html).toContain('Incident Description');
    expect(html).toContain('PostgreSQL connection pool exhausted on ap-south-1 cluster.');
  });

  it('includes dedicated OpsKnightPromoCard with open-source branding and GitHub/docs links', () => {
    const html = generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    expect(html).toContain('OpsKnight');
    expect(html).toContain('Open-Source');
    expect(html).toContain('https://github.com/opsknight-labs/OpsKnight');
    expect(html).toContain('⭐ Star on GitHub');
    expect(html).toContain('https://docs.opsknight.com');
  });

  it('deduplicates eventMessage if it echoes incident title or [Service] title', () => {
    // Case 1: eventMessage duplicates [Checkout & Payments] Payment Gateway Connection Timeout
    const duplicateHtml = generateIncidentEmailHTML(
      baseIncident,
      'UTC',
      'triggered',
      `[Checkout & Payments] ${baseIncident.title}`
    );
    // Should NOT render a standalone duplicate box for the echo
    expect(duplicateHtml).not.toContain(
      `padding:12px 16px;margin:16px 0;color:#334155;font-size:13px;line-height:1.5;">[Checkout &amp; Payments]`
    );

    // Case 2: Distinct eventMessage provides unique escalation info
    const distinctHtml = generateIncidentEmailHTML(
      baseIncident,
      'UTC',
      'triggered',
      'Escalation Level 2: Paged Secondary On-Call'
    );
    expect(distinctHtml).toContain('Escalation Level 2: Paged Secondary On-Call');
  });
});

describe('Shift Reminder & Handoff Email Templates', () => {
  it('generates a polished upcoming shift reminder email with countdown and checklist', () => {
    const data = {
      userName: 'Sarah Chen',
      scheduleName: 'Primary Tier-1 SRE',
      scheduleUrl: 'https://opsknight.com/schedules/sched-123',
      shiftStart: new Date('2026-09-05T18:00:00Z'),
      shiftEnd: new Date('2026-09-06T02:00:00Z'),
      timeZone: 'America/New_York',
      minutesUntilStart: 60,
    };

    const html = generateShiftReminderEmailHTML(data);

    // Header gradient should be purple/violet
    expect(html).toContain('linear-gradient(135deg, #4c1d95 0%, #6d28d9 45%, #7c3aed 100%)');
    expect(html).toContain('Upcoming On-Call Shift');
    expect(html).toContain('Primary Tier-1 SRE');
    expect(html).toContain('Sarah Chen');
    expect(html).toContain('~60 minute(s)');
    expect(html).toContain('Responder Checklist');
    expect(html).toContain('View On-Call Schedule');
    expect(html).toContain('https://opsknight.com/schedules/sched-123');
  });

  it('generates a shift handoff email with reassigned active incidents', () => {
    const data = {
      userName: 'David Miller',
      scheduleName: 'Platform Infrastructure Rotation',
      scheduleUrl: 'https://opsknight.com/schedules/sched-456',
      activeIncidents: [
        {
          id: 'inc-101',
          title: 'High CPU utilization on Redis cluster',
          status: 'ACKNOWLEDGED',
          incidentUrl: 'https://opsknight.com/incidents/inc-101',
        },
        {
          id: 'inc-102',
          title: 'Kafka Consumer Lag Spike',
          status: 'TRIGGERED',
          incidentUrl: 'https://opsknight.com/incidents/inc-102',
        },
      ],
      timeZone: 'UTC',
    };

    const html = generateShiftHandoffEmailHTML(data);

    expect(html).toContain('Shift Rotation Handoff');
    expect(html).toContain('David Miller');
    expect(html).toContain('Platform Infrastructure Rotation');
    expect(html).toContain('2 active incident(s)');
    expect(html).toContain('High CPU utilization on Redis cluster');
    expect(html).toContain('Kafka Consumer Lag Spike');
    expect(html).toContain('https://opsknight.com/incidents/inc-101');
    expect(html).toContain('https://opsknight.com/incidents/inc-102');
  });
});
