import { describe, expect, it } from 'vitest';
import {
  getAuthenticationSecurityEmailTemplate,
  getSsoInvitationEmailTemplate,
} from '@/lib/authentication-email-template';
import { getUserInviteEmailTemplate } from '@/lib/user-invite-email-template';

const fixture = {
  title: 'Security alert: auth.policy.changed',
  message: 'Authentication policy changed. Review the recorded event.',
  eventId: 'event-reference-123',
  createdAt: new Date('2026-10-15T10:00:00Z'),
  origin: 'https://ops.example.test',
  event: {
    eventType: 'auth.policy.changed',
    outcome: 'success',
    createdAt: new Date('2026-10-15T09:59:00Z'),
  },
};
describe('authentication emails use the incident email design system', () => {
  it('includes branded responsive/dark-mode components, recorded metadata and a canonical diagnostics action', async () => {
    const result = await getAuthenticationSecurityEmailTemplate(fixture);
    expect(result.subject).toBe('[OpsKnight] Authentication policy changed');
    for (const value of [
      '<!DOCTYPE html',
      'mobile-container',
      'desktop-container',
      '@media (prefers-color-scheme:dark)',
      'dm-info-label',
      'dm-bg-muted',
      'Recorded security summary',
      'Recommended next step',
      'event-reference-123',
      '2026-10-15T09:59:00.000Z',
      'https://opsknight.com/',
      // Logo comes from the canonical authenticated origin, never event context.
      'https://ops.example.test/images/email/opsknight-logo@2x.png',
    ])
      expect(result.html).toContain(value);
    expect(result.html).toContain(
      'https://ops.example.test/settings/system?section=sso&amp;authTab=diagnostics&amp;authView=audit'
    );
    expect(result.html).not.toContain('&amp;amp;');
    expect(result.text).toContain('Recorded outcome: success');
    expect(result.text).toContain('section=sso&authTab=diagnostics&authView=audit');
    expect(result.text).toContain('No password or security-key response is requested');
  });
  it.each([
    ['auth.emergency.login.success', 'Emergency access used', '#be123c'],
    ['auth.emergency.recovery.degraded', 'Emergency recovery readiness reduced', '#be123c'],
    ['auth.recovery.password.restored', 'Password recovery access restored', '#be123c'],
    ['auth.emergency.password.rotated', 'Emergency password rotated', '#d97706'],
    ['auth.oidc.test.failed', 'Administrator SSO verification failed', '#d97706'],
    ['auth.oidc.test.success', 'Administrator SSO sign-in verified', '#059669'],
    ['auth.oidc.revision.staged', 'SSO configuration staged', '#2563eb'],
    ['auth.emergency.credential.enrolled', 'Recovery security key enrolled', '#d97706'],
    ['auth.user.sso.invited', 'SSO user invitation created', '#2563eb'],
  ])('uses clear event-specific presentation for %s', async (eventType, title, accent) => {
    const result = await getAuthenticationSecurityEmailTemplate({
      ...fixture,
      event: { ...fixture.event, eventType },
    });
    expect(result.subject).toBe(`[OpsKnight] ${title}`);
    expect(result.html).toContain(`border-left:4px solid ${accent}`);
    expect(result.text).toContain(`Event type: ${eventType}`);
  });
  it('preserves aggregate failure counts and provides an honest fallback for retained events', async () => {
    const result = await getAuthenticationSecurityEmailTemplate({
      ...fixture,
      title: 'Emergency sign-in failures detected',
      message: '20 unauthenticated failures in five minutes.',
    });
    expect(result.subject).toBe('[OpsKnight] Emergency sign-in failures detected');
    expect(result.text).toContain('20 unauthenticated failures');
    const legacy = await getAuthenticationSecurityEmailTemplate({ ...fixture, event: undefined });
    expect(legacy.text).not.toContain('Recorded outcome:');
    expect(legacy.text).toContain('event-reference-123');
  });
  it('escapes untrusted display fields and rejects unsafe or credential-bearing origins', async () => {
    const result = await getAuthenticationSecurityEmailTemplate({
      ...fixture,
      message: '<img src=x onerror=alert(1)>',
      eventId: '<script>event</script>',
      event: { ...fixture.event, eventType: '<script>type</script>' },
    });
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
    for (const origin of [
      'javascript:alert(1)',
      'mailto:admin@example.test',
      'https://user:password@example.test',
    ])
      await expect(getAuthenticationSecurityEmailTemplate({ ...fixture, origin })).rejects.toThrow();
  });
  it('routes SSO invitations through the same components with expiry and no password setup', async () => {
    const result = await getUserInviteEmailTemplate({
      userName: 'Jordan <script>',
      invitedBy: 'Admin <img>',
      ssoOnly: true,
      inviteUrl: 'https://ops.example.test/login',
      expiresInDays: 7,
    });
    expect(result.subject).toBe('[OpsKnight] Invitation to sign in with SSO');
    for (const value of [
      'dm-info-label',
      'dm-bg-muted',
      'Sign in with SSO',
      'Expires in 7 days',
      'https://opsknight.com/',
      'no password setup is required',
    ])
      expect(result.html).toContain(value);
    expect(result.html).toContain('Jordan &lt;script&gt;');
    expect(result.html).not.toContain('Admin <img>');
    expect(result.html).not.toContain('Set up your account');
    expect(result.text).toContain('ask them to renew it');
    expect(
      (
        await getSsoInvitationEmailTemplate({
          userName: 'User',
          inviteUrl: 'https://ops.example.test/login?untrusted=ignored',
        })
      ).html
    ).not.toContain('untrusted=ignored');
  });
});
