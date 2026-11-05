import { describe, it, expect } from 'vitest';
import {
  generateIncidentEmailHTML,
  generateShiftReminderEmailHTML,
  generateShiftHandoffEmailHTML,
} from '@/lib/email';
import { getUserInviteEmailTemplate } from '@/lib/user-invite-email-template';
import { getPasswordResetEmailTemplate } from '@/lib/password-reset-email-template';
import { toneTokens, type EmailTone } from '@/emails/tokens';

/** Header band: Outlook solid fallback + documented deep → base gradient for everyone else. */
function expectHeaderTone(html: string, tone: EmailTone) {
  const t = toneTokens(tone);
  expect(html).toContain(`bgcolor="${t.deep}"`);
  expect(html).toContain(`linear-gradient(135deg, ${t.deep} 0%, ${t.base} 100%)`);
}

/** CTA: VML roundrect for Outlook desktop and a solid-fill link for every other client. */
function expectButtonTone(html: string, tone: EmailTone) {
  const fill = toneTokens(tone).button;
  expect(html).toContain(`fillcolor="${fill}"`);
  expect(html).toContain(`background-color:${fill}`);
}

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

  it('generates a Crimson template for Critical / HIGH urgency incidents', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    expectHeaderTone(html, 'critical');
    expectButtonTone(html, 'critical');
    expect(html).toContain('Critical Incident');
    expect(html).toContain('Payment Gateway Connection Timeout');
    expect(html).toContain('Checkout &amp; Payments');
    expect(html).toContain('View Incident');
    expect(html).toContain('https://opsknight.com/incidents/inc-12345');
  });

  it('generates an Amber template for Elevated / MEDIUM urgency incidents', async () => {
    const html = await generateIncidentEmailHTML(
      { ...baseIncident, urgency: 'MEDIUM' },
      'UTC',
      'triggered'
    );
    expectHeaderTone(html, 'elevated');
    expectButtonTone(html, 'elevated');
    expect(html).toContain('Elevated Incident');
  });

  it('generates an Emerald template for Resolved incidents', async () => {
    const html = await generateIncidentEmailHTML(
      { ...baseIncident, status: 'RESOLVED', resolvedAt: new Date('2026-09-05T10:30:00Z') },
      'UTC',
      'resolved'
    );
    expectHeaderTone(html, 'ok');
    expectButtonTone(html, 'ok');
    expect(html).toContain('Resolved');
    expect(html).toContain('View Resolution');
  });

  it('generates an Amber template for Acknowledged incidents', async () => {
    const html = await generateIncidentEmailHTML(
      { ...baseIncident, status: 'ACKNOWLEDGED', acknowledgedAt: new Date('2026-09-05T10:05:00Z') },
      'UTC',
      'acknowledged'
    );
    expectHeaderTone(html, 'elevated');
    expect(html).toContain('Acknowledged');
  });

  it('generates a Cobalt template for updated incidents', async () => {
    const html = await generateIncidentEmailHTML({ ...baseIncident, urgency: 'LOW' }, 'UTC', 'updated');
    expectHeaderTone(html, 'info');
    expect(html).toContain('Updated');
  });

  it('renders a 640px Outlook ghost table with responsive and big-screen tiers', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');

    expect(html).toContain('max-width:640px');
    expect(html).toContain('<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640"');
    expect(html).toContain('name="viewport"');
    for (const hook of ['mobile-container', 'mobile-outer-padding', 'mobile-table-cell', 'mobile-table-label'])
      expect(html).toContain(hook);
    expect(html).toContain('.desktop-container{max-width:1080px!important');
    expect(html).toContain('.desktop-container{max-width:1180px!important');
  });

  it('is Outlook-safe: no gradient without a solid fallback, no SVG, no flex', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/display:\s*(inline-)?flex/);
    expect(html).not.toMatch(/style="background:\s*linear-gradient/);
    expect(html).toContain('v:roundrect');
    expect(html).toContain("font-family:'Segoe UI',Arial,sans-serif!important");
  });

  it('renders a dedicated Incident Description card', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');
    expect(html).not.toContain('<h3 style="font-size:14px">Overview</h3>');
    expect(html).toContain('Incident Description');
    expect(html).toContain('PostgreSQL connection pool exhausted on ap-south-1 cluster.');
    expect(html).toContain('white-space:pre-wrap');
  });

  it('includes subtle branding in the footer without promotional blocks', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');
    expect(html).toContain('OpsKnight');
    expect(html).toContain('Open-Source Incident Response');
    expect(html).toContain('automated notification');
    expect(html).not.toContain('⭐ Star on GitHub');
    expect(html).not.toContain('https://docs.opsknight.com');
  });

  it('hyperlinks the OpsKnight logo, name and footer to https://opsknight.com/', async () => {
    const html = await generateIncidentEmailHTML(baseIncident, 'UTC', 'triggered');
    const brandLinks = html.match(/href="https:\/\/opsknight\.com\/"/g) ?? [];
    expect(brandLinks.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('/images/email/opsknight-logo@2x.png');
    // Logo sits on a white chip inside the status band, with its true aspect ratio.
    expect(html).toMatch(/<img[^>]+width="24"[^>]+height="26"/);
    expect(html).toContain('class="desktop-logo-chip"');
  });

  it('deduplicates eventMessage if it echoes incident title or [Service] title', async () => {
    const duplicateHtml = await generateIncidentEmailHTML(
      baseIncident,
      'UTC',
      'triggered',
      `[Checkout & Payments] ${baseIncident.title}`
    );
    expect(duplicateHtml).not.toContain('Latest update');

    const distinctHtml = await generateIncidentEmailHTML(
      baseIncident,
      'UTC',
      'triggered',
      'Escalation Level 2: Paged Secondary On-Call'
    );
    expect(distinctHtml).toContain('Latest update');
    expect(distinctHtml).toContain('Escalation Level 2: Paged Secondary On-Call');
  });

  it('escapes incident content', async () => {
    const html = await generateIncidentEmailHTML(
      { ...baseIncident, title: '<script>alert(1)</script>', description: '<img src=x onerror=1>' },
      'UTC',
      'triggered'
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('Shift Reminder & Handoff Email Templates', () => {
  it('generates an upcoming shift reminder with countdown and checklist in Royal Violet', async () => {
    const html = await generateShiftReminderEmailHTML({
      userName: 'Sarah Chen',
      scheduleName: 'Primary Tier-1 SRE',
      scheduleUrl: 'https://opsknight.com/schedules/sched-123',
      shiftStart: new Date('2026-09-05T18:00:00Z'),
      shiftEnd: new Date('2026-09-06T02:00:00Z'),
      timeZone: 'America/New_York',
      minutesUntilStart: 60,
    });

    expectHeaderTone(html, 'shift');
    expectButtonTone(html, 'shift');
    expect(html).toContain('Upcoming On-Call Shift');
    expect(html).toContain('Primary Tier-1 SRE');
    expect(html).toContain('Sarah Chen');
    expect(html).toContain('~60 minute(s)');
    expect(html).toContain('Responder Checklist');
    expect(html).toContain('View On-Call Schedule');
    expect(html).toContain('https://opsknight.com/schedules/sched-123');
  });

  it('generates a shift handoff email with reassigned active incidents', async () => {
    const html = await generateShiftHandoffEmailHTML({
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
    });

    expectHeaderTone(html, 'shift');
    expect(html).toContain('Shift Rotation Handoff');
    expect(html).toContain('David Miller');
    expect(html).toContain('Platform Infrastructure Rotation');
    expect(html).toContain('2 active incident(s)');
    expect(html).toContain('High CPU utilization on Redis cluster');
    expect(html).toContain('Kafka Consumer Lag Spike');
    expect(html).toContain('https://opsknight.com/incidents/inc-101');
    expect(html).toContain('https://opsknight.com/incidents/inc-102');
  });

  it('caps handoff incidents to the default limit of 5 with an overflow card', async () => {
    const incidents = Array.from({ length: 9 }, (_, i) => ({
      id: `inc-${i + 1}`,
      title: `Incident Service Outage #${i + 1}`,
      status: i % 2 === 0 ? 'TRIGGERED' : 'ACKNOWLEDGED',
      incidentUrl: `https://opsknight.com/incidents/inc-${i + 1}`,
    }));
    const html = await generateShiftHandoffEmailHTML({
      userName: 'David Miller',
      scheduleName: 'Platform Infrastructure Rotation',
      scheduleUrl: 'https://opsknight.com/schedules/sched-456',
      activeIncidents: incidents,
      timeZone: 'UTC',
    });

    expect(html).toContain('9 active incident(s)');
    expect(html).toContain('showing top 5');
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`Incident Service Outage #${i}`);
      expect(html).toContain(`https://opsknight.com/incidents/inc-${i}`);
    }
    expect(html).not.toContain('Incident Service Outage #6');
    expect(html).not.toContain('https://opsknight.com/incidents/inc-6');
    expect(html).toContain('+ 4 more active incidents assigned to this shift.');
    expect(html).toContain('View all on schedule');
  });

  it('allows a custom maxIncidents cap', async () => {
    const incidents = Array.from({ length: 4 }, (_, i) => ({
      id: `inc-${i + 1}`,
      title: `Incident #${i + 1}`,
      status: 'TRIGGERED',
      incidentUrl: `https://opsknight.com/incidents/inc-${i + 1}`,
    }));
    const html = await generateShiftHandoffEmailHTML({
      userName: 'David Miller',
      scheduleName: 'Tier 1 Support',
      scheduleUrl: 'https://opsknight.com/schedules/sched-789',
      activeIncidents: incidents,
      timeZone: 'UTC',
      maxIncidents: 2,
    });
    expect(html).toContain('Incident #1');
    expect(html).toContain('Incident #2');
    expect(html).not.toContain('Incident #3');
    expect(html).toContain('+ 2 more active incidents assigned to this shift.');
  });
});

describe('Email Templates Dark Mode Compliance', () => {
  it('ships all three dark-mode layers and color-scheme metadata', async () => {
    const html = await generateIncidentEmailHTML(
      {
        id: 'inc-999',
        title: 'Dark Mode Verification Incident',
        status: 'TRIGGERED',
        urgency: 'HIGH',
        service: { name: 'Core API' },
        createdAt: new Date('2026-09-05T10:00:00Z'),
      },
      'UTC',
      'triggered'
    );

    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('name="supported-color-schemes" content="light dark"');
    // 1. Apple Mail / Outlook Mac & iOS
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    // 2. Outlook.com / new Outlook
    expect(html).toContain('[data-ogsc] .dm-text-heading');
    expect(html).toContain('[data-ogsb] .dm-bg-card');
    for (const hook of ['dm-bg-page', 'dm-bg-card', 'dm-text-heading', 'dm-text-body'])
      expect(html).toContain(hook);
  });
});

describe('User Invite Email Template', () => {
  it('generates the invite email with subject, CTA, expiry and dark mode support', async () => {
    const result = await getUserInviteEmailTemplate({
      userName: 'Jordan Lee',
      inviteUrl: 'https://opsknight.com/invite/tok123',
      invitedBy: 'Admin Team',
      expiresInDays: 7,
    });

    expect(result.subject).toBe("[OpsKnight] You're invited to join");
    expect(result.html).toContain('Hi <!-- -->Jordan Lee<!-- -->,');
    expect(result.html).toContain('<strong class="dm-text-heading"');
    expect(result.html).toContain('Admin Team');
    expect(result.html).toContain('Click the button below to set your password and access your account.');
    expect(result.html).toContain('This invite link expires in <!-- -->7 days');
    expect(result.html).toContain('https://opsknight.com/invite/tok123');
    expect(result.html).toContain('@media (prefers-color-scheme:dark)');
    expect(result.html).toContain('dm-text-heading');

    expect(result.text).toContain('[OpsKnight] Invitation');
    expect(result.text).toContain('Hi Jordan Lee,');
    expect(result.text).toContain('https://opsknight.com/invite/tok123');
  });
});

describe('Password Reset Email Template', () => {
  it('generates the reset email with subject, security notice, expiry and dark mode support', async () => {
    const result = await getPasswordResetEmailTemplate({
      userName: 'Alex Morgan',
      resetLink: 'https://opsknight.com/reset-password/tok456',
      expiryMinutes: 60,
    });

    expect(result.subject).toBe('[OpsKnight] Reset your password');
    expect(result.html).toContain('Alex Morgan');
    expect(result.html).toContain('Security Notice');
    expect(result.html).not.toContain('🛡️ Security Notice');
    expect(result.html).toContain('This link expires in <!-- -->60 minutes');
    expect(result.html).toContain('https://opsknight.com/reset-password/tok456');
    expect(result.html).toContain('@media (prefers-color-scheme:dark)');
    expect(result.html).toContain('dm-text-heading');

    expect(result.text).toContain('[OpsKnight] Password Reset Request');
    expect(result.text).toContain('Hi Alex Morgan,');
    expect(result.text).toContain('This is an automated message from OpsKnight.');
    expect(result.text).not.toContain('Incident Management');
  });
});
