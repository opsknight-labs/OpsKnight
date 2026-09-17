import { describe, it, expect, vi, beforeEach } from 'vitest';

function countStub(value = 0) {
  return vi.fn().mockResolvedValue(value);
}

function buildMockPrisma() {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { count: countStub() },
    incidentWatcher: { count: countStub() },
    onCallShift: { count: countStub() },
    onCallLayerUser: { count: countStub() },
    onCallOverride: { count: countStub() },
    userToken: { count: countStub() },
    oidcConfig: { count: countStub() },
    slackIntegration: { count: countStub() },
    auditLog: { count: countStub() },
  };
}

const state = vi.hoisted(() => ({
  current: null as unknown as ReturnType<typeof buildMockPrisma>,
}));
vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, { get: (_t, prop) => (state.current as never)[prop] }),
}));

import { verifySubjectErasure } from '@/lib/privacy/erasure/verify';

const SUBJECT_ID = 'cuserA0000001';

describe('verifySubjectErasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.current = buildMockPrisma();
  });

  it('verifies cleanly when nothing references the subject anymore', async () => {
    const result = await verifySubjectErasure(SUBJECT_ID, { originalEmail: 'alice@example.com' });
    expect(result).toEqual({ verified: true, issues: [] });
  });

  it('flags a still-existing user row', async () => {
    state.current.user.findUnique.mockResolvedValue({ id: SUBJECT_ID });

    const result = await verifySubjectErasure(SUBJECT_ID);
    expect(result.verified).toBe(false);
    expect(result.issues).toContain('User row still exists.');
  });

  it('flags residual RESTRICT-handled rows by count', async () => {
    state.current.teamMember.count.mockResolvedValue(2);
    state.current.onCallShift.count.mockResolvedValue(1);

    const result = await verifySubjectErasure(SUBJECT_ID);
    expect(result.verified).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        '2 team membership row(s) remain.',
        '1 active/future on-call shift row(s) remain.',
      ])
    );
  });

  it('flags a residual audit-log PII snapshot matched by original email', async () => {
    state.current.auditLog.count.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => ('actorEmail' in where ? 1 : 0)
    );

    const result = await verifySubjectErasure(SUBJECT_ID, { originalEmail: 'alice@example.com' });
    expect(result.verified).toBe(false);
    expect(result.issues).toContain("1 audit log row(s) still expose the subject's actor email.");
  });

  it('does not query by email when no originalEmail is supplied', async () => {
    await verifySubjectErasure(SUBJECT_ID);
    expect(state.current.userToken.count).toHaveBeenCalledTimes(1);
    expect(state.current.userToken.count).toHaveBeenCalledWith({ where: { userId: SUBJECT_ID } });
  });
});
