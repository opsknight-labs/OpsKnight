import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRulePolicyAction } from '@/app/(app)/services/[id]/runbook-actions';
import { RunbookDefinitionError } from '@/lib/runbooks/errors';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  assertCanModifyService: vi.fn(),
  assertCapability: vi.fn(),
  requestRulePolicyChecks: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.assertCanModifyService,
  assertCanViewService: vi.fn(),
  assertCapability: mocks.assertCapability,
}));
vi.mock('@/lib/runbooks/policy-checks', () => ({
  requestRulePolicyChecks: mocks.requestRulePolicyChecks,
}));
vi.mock('@/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      error: vi.fn((...args: [any, ...any[]]) => {
        mocks.loggerError(...args);
        return (actual.logger.error as any)(...args);
      }),
    },
  };
});

const serviceId = 'cmv7kbd0l000cxlzuo1cmhu1e';
const ruleId = 'cmv7kbd0l000dxlzuo1cmhu1e';

describe('checkRulePolicyAction error handling and security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'actor-1' });
    mocks.assertCapability.mockResolvedValue({ id: 'actor-1' });
  });

  it('returns structured userMessage for expected RunbookError validation failures', async () => {
    mocks.requestRulePolicyChecks.mockRejectedValueOnce(
      new RunbookDefinitionError(
        'A policy check requires 1–100 online targets. Narrow the selector.'
      )
    );

    const result = await checkRulePolicyAction(serviceId, ruleId);

    expect(result).toEqual({
      error: 'A policy check requires 1–100 online targets. Narrow the selector.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('masks unexpected internal/database errors with a generic message and logs via sanitized logger', async () => {
    const dbError = new Error(
      'FATAL: Connection pool exhausted at postgresql://user:secret@db:5432/opsknight'
    );
    mocks.requestRulePolicyChecks.mockRejectedValueOnce(dbError);

    const result = await checkRulePolicyAction(serviceId, ruleId);

    expect(result).toEqual({
      error: 'Could not complete policy check. Please check configuration and try again.',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to check rule policy',
      expect.objectContaining({
        error: dbError,
        serviceId,
        ruleId,
        component: 'runbook-actions',
      })
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    // Verify real logger serialized output in log buffer
    const { getLogBuffer } = await import('@/lib/logger');
    const entries = getLogBuffer(20);
    const logEntry = entries.find(e => e.message === 'Failed to check rule policy');
    expect(logEntry).toBeDefined();
    expect(logEntry?.error?.message).toBe(
      'FATAL: Connection pool exhausted at postgresql://user:[REDACTED]@db:5432/opsknight'
    );
    const serializedLog = JSON.stringify(logEntry);
    expect(serializedLog).not.toContain('secret');
    expect(serializedLog).toContain('[REDACTED]');
  });

  it('revalidates path and returns policy check result on success', async () => {
    mocks.requestRulePolicyChecks.mockResolvedValueOnce({ saved: true, checkedTargets: 3 });

    const result = await checkRulePolicyAction(serviceId, ruleId);

    expect(result).toEqual({ saved: true, checkedTargets: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/services/${serviceId}`);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
