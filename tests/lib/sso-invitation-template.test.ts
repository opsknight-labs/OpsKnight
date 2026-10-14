import { describe, expect, it } from 'vitest';
import { getUserInviteEmailTemplate } from '@/lib/user-invite-email-template';
describe('password-free invitation instructions', () => {
  it('describes verified SSO linking without suggesting password setup', () => {
    const result = getUserInviteEmailTemplate({
      userName: '<script>unsafe</script>',
      inviteUrl: 'https://instance.example.test/login',
      ssoOnly: true,
    });
    expect(result.text).toContain('no password setup is required');
    expect(result.html).toContain('Sign in with SSO');
    expect(result.html).not.toContain('set your password');
    expect(result.html).not.toContain('<script>unsafe</script>');
    expect(result.text).toContain('first-link approval expires in 7 days');
  });
});
