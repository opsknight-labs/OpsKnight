import { describe, expect, it } from 'vitest';
import {
  ADMIN_TEST_MESSAGES,
  SESSION_END_MESSAGES,
  SIGN_IN_MESSAGES,
  signInCodeForOidcFailure,
  signInMessageFor,
} from '@/lib/auth-control/messages';

describe('authentication message catalog', () => {
  it('has a message for every OIDC rejection reason', () => {
    for (const reason of [
      'OIDC_LINK_NOT_APPROVED',
      'OIDC_LINK_APPROVAL_EXPIRED',
      'OIDC_DOMAIN_NOT_ALLOWED',
      'OIDC_ORGANIZATION_REJECTED',
      'OIDC_AUTO_PROVISION_DISABLED',
      'OIDC_TARGET_NOT_OPERATIONAL',
      'OIDC_EMAIL_REQUIRED',
      'OIDC_EMAIL_ASSURANCE_REQUIRED',
      'OIDC_AMBIGUOUS_IDENTITY_CONFLICT',
      'OIDC_ROLE_UNMATCHED_DENIED',
    ]) {
      const code = signInCodeForOidcFailure(reason);
      expect(code).not.toBe('SSO_INTERNAL_ERROR');
      expect(new Map(Object.entries(SIGN_IN_MESSAGES)).has(code)).toBe(true);
    }
    expect(signInCodeForOidcFailure('SOMETHING_NEW')).toBe('SSO_INTERNAL_ERROR');
  });

  it('only promises a notification that was actually sent', () => {
    expect(
      signInMessageFor('SSO_LINK_NOT_APPROVED', { administratorsNotified: true })?.action
    ).toMatch(/have been notified/);
    expect(signInMessageFor('SSO_LINK_NOT_APPROVED')?.action).not.toMatch(/notified/);
  });

  it('sends every "test again" fix to the step where the test lives', () => {
    for (const [code, message] of Object.entries(ADMIN_TEST_MESSAGES)) {
      if (/test|retest/i.test(message.fix.label)) expect(message.fix.step, code).toBe('policy');
      if (/role rules/i.test(message.fix.label)) expect(message.fix.step, code).toBe('roles');
      if (/allowed domains/i.test(message.fix.label)) expect(message.fix.step, code).toBe('access');
    }
  });

  it('writes every message in full sentences people can act on', () => {
    const all = [
      ...Object.values(SIGN_IN_MESSAGES),
      ...Object.values(SESSION_END_MESSAGES),
      ...Object.values(ADMIN_TEST_MESSAGES),
    ];
    for (const message of all) {
      expect(message.title.length).toBeGreaterThan(5);
      expect(message.detail).toMatch(/[.!]$/);
      if (message.action) expect(message.action).toMatch(/[.!]$/);
      expect(`${message.title} ${message.detail} ${message.action}`).not.toMatch(
        /\b(stage|staged|revision|discovery)\b/i
      );
    }
  });
});
