import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  getUserPermissions: vi.fn(),
  emitAuditEvent: vi.fn(),
  invalidate: vi.fn(),
  revalidatePath: vi.fn(),
  loggerError: vi.fn(),
  acquireAdvisoryLock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/rbac', () => ({ getUserPermissions: mocks.getUserPermissions }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.emitAuditEvent }));
vi.mock('@/lib/incident-sla/scheduler-control', () => ({
  invalidateSlaSchedulerMode: mocks.invalidate,
  MIN_CLEAN_SHADOW_CHECKS: 3,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn() } }));
vi.mock('@/lib/db-locks', () => ({
  acquireAdvisoryLock: mocks.acquireAdvisoryLock,
  LOCK_KEYS: { SLA_SCHEDULER: BigInt(1762184301) },
}));

import { saveSlaSchedulerModeAction } from '@/app/(app)/settings/incident-sla/actions';

function configureTransaction(config?: {
  current?: Record<string, unknown> | null;
  ready?: boolean;
  missingHints?: number;
  fail?: Error;
}) {
  const upsert = vi.fn().mockResolvedValue({});
  mocks.transaction.mockImplementation(async callback => {
    if (config?.fail) throw config.fail;
    return callback({
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { ready: config?.ready ?? false, missing_hints: BigInt(config?.missingHints ?? 0) },
        ]),
      systemConfig: {
        findUnique: vi.fn().mockResolvedValue(
          config?.current === null
            ? null
            : { value: config?.current ?? { mode: 'LEGACY' } }
        ),
        upsert,
      },
    });
  });
  return { upsert };
}

describe('SLA scheduler mode action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserPermissions.mockResolvedValue({
      authenticated: true,
      id: 'admin-1',
      capabilities: ['admin.manage'],
    });
    mocks.emitAuditEvent.mockResolvedValue(undefined);
    mocks.acquireAdvisoryLock.mockResolvedValue(undefined);
  });

  it.each([
    ['LEGACY to SHADOW', { mode: 'LEGACY' }],
    ['missing config to SHADOW', null],
  ])('allows %s without checking index readiness', async (_label, current) => {
    const { upsert } = configureTransaction({ current, ready: false, missingHints: 384 });
    await expect(saveSlaSchedulerModeAction('SHADOW')).resolves.toEqual({
      ok: true,
      mode: 'SHADOW',
    });
    expect(upsert).toHaveBeenCalled();
    expect(mocks.acquireAdvisoryLock).toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('rejects INDEXED with a controlled message when the index is missing', async () => {
    configureTransaction({
      current: { mode: 'SHADOW', lastShadowMismatchCount: 0, consecutiveCleanChecks: 3 },
      ready: false,
      missingHints: 0,
    });
    await expect(saveSlaSchedulerModeAction('INDEXED')).resolves.toEqual({
      ok: false,
      message: 'Install the SLA scheduler index before enabling Indexed mode.',
    });
  });

  it('returns a controlled error when persistence or audit fails', async () => {
    configureTransaction({ fail: new Error('database unavailable') });
    await expect(saveSlaSchedulerModeAction('SHADOW')).resolves.toEqual({
      ok: false,
      message: 'Unable to change SLA scheduler mode.',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[IncidentSlaScheduler] Mode change failed',
      expect.objectContaining({ mode: 'SHADOW', actorId: 'admin-1' })
    );
  });
});
