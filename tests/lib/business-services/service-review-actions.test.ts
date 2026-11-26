import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  saveReviewConfig: vi.fn(),
  sendReviewPreview: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(async () => ({ id: 'admin-1' })),
  getUserPermissions: vi.fn(async () => ({ isAdmin: true, isResponderOrAbove: true })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/business-services/reviews/config', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/business-services/reviews/config')>()),
  saveReviewConfig: mocks.saveReviewConfig,
}));
vi.mock('@/lib/business-services/reviews/run', () => ({
  runServiceReviews: vi.fn(),
  sendReviewPreview: mocks.sendReviewPreview,
}));

const { saveServiceReviewSettings, sendServiceReviewPreview } = await import(
  '@/app/(app)/settings/service-review-actions'
);

beforeEach(() => vi.clearAllMocks());

describe('service review actions: what reaches the browser', () => {
  it('returns a validation message for bad input', async () => {
    const result = await saveServiceReviewSettings({ dayOfMonth: 99 });
    expect(result).toMatchObject({ success: false });
    expect((result as { error: string }).error).not.toMatch(/prisma|database|ECONN/i);
  });

  it('shows the user message of an expected domain error', async () => {
    mocks.sendReviewPreview.mockRejectedValueOnce(
      new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Try again in an hour.' })
    );
    expect(await sendServiceReviewPreview()).toEqual({
      success: false,
      error: 'Try again in an hour.',
    });
  });

  it('hides unexpected database or provider errors and logs them server-side', async () => {
    mocks.sendReviewPreview.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 172.31.6.228:5432 (password authentication failed)')
    );
    const result = await sendServiceReviewPreview();
    expect(result).toEqual({ success: false, error: 'Something went wrong. Try again.' });
    expect(JSON.stringify(result)).not.toContain('172.31.6.228');
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});
