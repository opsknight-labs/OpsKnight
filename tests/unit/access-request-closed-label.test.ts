import { describe, expect, it } from 'vitest';

import { closedByApprover } from '@/lib/access/requests';

describe('who closed a cancelled access request', () => {
  it('is the requester when they withdrew it', () => {
    expect(closedByApprover({ requesterId: 'u1', decidedById: 'u1' })).toBe(false);
  });

  it('is an approver when someone else closed an already satisfied request', () => {
    expect(closedByApprover({ requesterId: 'u1', decidedById: 'approver-1' })).toBe(true);
  });

  it('is nobody when no decider was recorded', () => {
    expect(closedByApprover({ requesterId: 'u1', decidedById: null })).toBe(false);
  });
});
