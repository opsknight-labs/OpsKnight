import { describe, it, expect } from 'vitest';
import { isAutomatedRequest } from '@/components/settings/privacy/PrivacyRequestsBoard';

describe('isAutomatedRequest', () => {
  it('is automated for USER + ACCESS or PORTABILITY', () => {
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'ACCESS' })).toBe(true);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'PORTABILITY' })).toBe(true);
  });

  it('is never automated for STATUS_SUBSCRIBER, even for ACCESS/PORTABILITY', () => {
    expect(isAutomatedRequest({ subjectType: 'STATUS_SUBSCRIBER', requestType: 'ACCESS' })).toBe(
      false
    );
    expect(
      isAutomatedRequest({ subjectType: 'STATUS_SUBSCRIBER', requestType: 'PORTABILITY' })
    ).toBe(false);
  });

  it('is not automated for USER requests of a non-automated type', () => {
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'ERASURE' })).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'RECTIFICATION' })).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'RESTRICTION' })).toBe(false);
    expect(isAutomatedRequest({ subjectType: 'USER', requestType: 'OBJECTION' })).toBe(false);
  });
});
