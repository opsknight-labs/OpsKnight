import { describe, it, expect } from 'vitest';
import { getVerificationEmailTemplate } from '@/lib/status-page-email-templates';
import { renderEmail } from '@/emails/render';
import { StatusUpdateEmail, statusUpdatePresentation } from '@/emails/templates/status-update';
import {
  StatusAnnouncementEmail,
  announcementEndTimeSection,
  announcementPresentation,
} from '@/emails/templates/status-announcement';
import { toneTokens } from '@/emails/tokens';

const page = {
  pageName: 'Test Status Page',
  statusPageUrl: 'https://status.example.com',
};

async function renderUpdate(overrides: Partial<Parameters<typeof StatusUpdateEmail>[0]> = {}) {
  return renderEmail(
    StatusUpdateEmail({
      ...page,
      eventType: 'triggered',
      incidentTitle: 'Service Outage',
      serviceName: 'API',
      description: 'We are investigating.',
      unsubscribeUrl: '{{unsubscribe_url}}',
      ...overrides,
    })
  );
}

describe('Status page subscriber update email', () => {
  it('maps lifecycle events to the documented tones', () => {
    expect(statusUpdatePresentation('triggered')).toEqual({ label: 'New Incident', tone: 'critical' });
    expect(statusUpdatePresentation('investigating').tone).toBe('elevated');
    expect(statusUpdatePresentation('monitoring').tone).toBe('info');
    expect(statusUpdatePresentation('resolved').tone).toBe('ok');
    expect(statusUpdatePresentation('something-else')).toEqual({ label: 'Update', tone: 'info' });
  });

  it('keeps the per-recipient unsubscribe placeholder intact for send-time substitution', async () => {
    const { html } = await renderUpdate();
    // Regression: sanitising used to turn the placeholder into "#", so every subscriber
    // email shipped a dead unsubscribe link.
    expect(html).toContain('href="{{unsubscribe_url}}"');
    expect(html).toContain('Unsubscribe from updates');
    expect(html).not.toMatch(/href="#"[^>]*>Unsubscribe/);
  });

  it('shows the subscriber reason and Powered by OpsKnight linked to opsknight.com', async () => {
    const { html } = await renderUpdate();
    expect(html).toContain('you are subscribed to');
    expect(html).toContain('Test Status Page');
    expect(html).toContain('Powered by');
    expect(html).toContain('href="https://opsknight.com/"');
  });

  it('brands the email with the status page and links its name to the page', async () => {
    const { html } = await renderUpdate({ logoUrl: 'https://cdn.example.com/acme.png' });
    expect(html).toContain('src="https://cdn.example.com/acme.png"');
    expect(html).toMatch(/href="https:\/\/status\.example\.com"[^>]*>Test Status Page<\/a>/);
    expect(html).toContain(`bgcolor="${toneTokens('critical').deep}"`);
  });

  it('honours privacy settings for service, description and timestamp', async () => {
    const { html } = await renderUpdate({
      serviceName: undefined,
      description: undefined,
      postedAt: undefined,
    });
    expect(html).not.toContain('Affecting service');
    expect(html).toContain('Additional incident details are not published.');
    expect(html).not.toContain('Posted on');
  });

  it('shows a support link only for http(s)/mailto URLs', async () => {
    const withSupport = await renderUpdate({ supportUrl: 'mailto:help@example.com' });
    expect(withSupport.html).toContain('href="mailto:help@example.com"');
    const without = await renderUpdate({ supportUrl: undefined });
    expect(without.html).toContain('Contact support via your usual channels.');
  });

  it('escapes HTML in user content', async () => {
    const { html, text } = await renderUpdate({
      incidentTitle: '<script>alert("xss")</script>',
      description: '<img src=x onerror=alert(1)>',
    });
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert');
    expect(text).toContain('<script>alert("xss")</script>');
  });

  it('escapes the page name exactly once', async () => {
    const { html } = await renderUpdate({ pageName: 'R&D Platform' });
    expect(html).toContain('R&amp;D Platform');
    expect(html).not.toContain('&amp;amp;');
  });

  it('handles long and special-character content', async () => {
    const longDescription = 'A'.repeat(1000);
    const { html, text } = await renderUpdate({
      incidentTitle: 'Service: "Critical" Issue (2024)',
      description: longDescription,
    });
    expect(html).toContain(longDescription);
    expect(text).toContain(longDescription);
    expect(html).toContain('Service: &quot;Critical&quot; Issue (2024)');
  });
});

describe('Status page announcement email', () => {
  it('maps announcement types to tones', () => {
    expect(announcementPresentation('INCIDENT')).toEqual({ label: 'Incident', tone: 'critical' });
    expect(announcementPresentation('MAINTENANCE').tone).toBe('info');
    expect(announcementPresentation('UPDATE').tone).toBe('ok');
    expect(announcementPresentation('WARNING').tone).toBe('elevated');
    expect(announcementPresentation('unknown')).toEqual({ label: 'Information', tone: 'neutral' });
  });

  it('keeps every per-recipient placeholder for send-time substitution', async () => {
    const { html } = await renderEmail(
      StatusAnnouncementEmail({
        ...page,
        type: 'MAINTENANCE',
        title: 'DB upgrade',
        message: 'Read-only for 2 minutes.',
        startTime: '{{start_time}}',
        endTimeSectionHtml: '{{end_time_section}}',
        postedAtSectionHtml: '{{posted_at_section}}',
        unsubscribeUrl: '{{unsubscribe_url}}',
      })
    );
    for (const token of ['{{start_time}}', '{{end_time_section}}', '{{posted_at_section}}'])
      expect(html).toContain(token);
    expect(html).toContain('href="{{unsubscribe_url}}"');
    expect(html).not.toMatch(/display:\s*flex/);
  });

  it('escapes formatted time fragments', () => {
    expect(announcementEndTimeSection('<b>soon</b>')).toContain('&lt;b&gt;soon&lt;/b&gt;');
  });
});

describe('Status page verification email', () => {
  it('keeps the subject format and renders a bulletproof verify CTA', async () => {
    const result = await getVerificationEmailTemplate({
      statusPageName: 'Test Status Page',
      statusPageUrl: 'https://status.example.com',
      verificationUrl: 'https://status.example.com/verify/tok',
    });
    expect(result.subject).toBe('[Test Status Page] 🔐 Verify your subscription');
    expect(result.html).toContain('Confirm Your Subscription');
    expect(result.html).toContain('https://status.example.com/verify/tok');
    expect(result.html).toContain('v:roundrect');
    expect(result.html).toContain('This link will expire in 7 days');
    expect(result.text).toContain('https://status.example.com/verify/tok');
  });

  it('uses the organization name and drops data: logos that mail clients block', async () => {
    const result = await getVerificationEmailTemplate({
      statusPageName: 'Internal',
      organizationName: 'Acme Inc',
      statusPageUrl: 'https://status.example.com',
      verificationUrl: 'https://status.example.com/verify/tok',
      logoUrl: 'data:image/png;base64,AAAA',
    });
    expect(result.subject).toBe('[Acme Inc] 🔐 Verify your subscription');
    expect(result.html).not.toContain('data:image');
  });
});
