import { describe, expect, it } from 'vitest';
import { canReadBusinessServiceFinancials } from '@/lib/business-services/financials';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
  id: 'u1',
  role,
  status: 'ACTIVE',
  teamIds: [],
});

describe('canReadBusinessServiceFinancials', () => {
  it.each(['USER', 'STAKEHOLDER', 'AUDITOR'] as const)('hides financials from %s', role => {
    expect(canReadBusinessServiceFinancials(actor(role))).toBe(false);
  });
  it('shows financials to admins', () => {
    expect(canReadBusinessServiceFinancials(actor('ADMIN'))).toBe(true);
  });
});
