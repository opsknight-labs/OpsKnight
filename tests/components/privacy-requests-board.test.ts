import { describe, it, expect } from 'vitest';
import { isAutomatedRequest } from '@/components/settings/privacy/PrivacyRequestsBoard';
import { PRIVACY_REQUEST_TRANSITIONS } from '@/lib/privacy/state-machine';

describe('isAutomatedRequest', () => {
  it('is automated for USER + ACCESS, PORTABILITY, or ERASURE', () => {
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'ACCESS' })).toBe(true);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'PORTABILITY' })).toBe(true);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'ERASURE' })).toBe(true);
  });

  it('is never automated for STATUS_SUBSCRIBER, even for ACCESS/PORTABILITY/ERASURE', () => {
    expect(isAutomatedRequest({ subjectType: 'STATUS_SUBSCRIBER', requestType: 'ACCESS' })).toBe(
      false
    );
    expect(
      isAutomatedRequest({ subjectType: 'STATUS_SUBSCRIBER', requestType: 'PORTABILITY' })
    ).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'STATUS_SUBSCRIBER', requestType: 'ERASURE' })).toBe(
      false
    );
  });

  it('is not automated for USER requests of a non-automated type', () => {
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'RECTIFICATION' })).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'RESTRICTION' })).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'OBJECTION' })).toBe(false);
  });
});

describe('privacy request board transitions', () => {
  it('exposes recovery paths without verification bypasses', () => {
    expect(PRIVACY_REQUEST_TRANSITIONS.RECEIVED).not.toContain('IN_REVIEW');
    expect(PRIVACY_REQUEST_TRANSITIONS.BLOCKED).not.toContain('PROCESSING');
    expect(PRIVACY_REQUEST_TRANSITIONS.IN_REVIEW).toContain('IDENTITY_VERIFICATION');
    expect(PRIVACY_REQUEST_TRANSITIONS.PROCESSING).toContain('IDENTITY_VERIFICATION');
    expect(PRIVACY_REQUEST_TRANSITIONS.BLOCKED).toContain('IDENTITY_VERIFICATION');
  });
});
