import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  restoreRunbookAction,
  checkRunbookDeleteEligibilityAction,
  deleteRunbookAction,
  duplicateRunbookAction,
  archiveRunbookAction,
} from '@/app/(app)/runbooks/actions';
import {
  checkRunbookDeleteEligibility,
  deleteRunbook,
  duplicateRunbook,
  restoreRunbook,
} from '@/lib/runbooks/lifecycle';
import { archiveRunbook } from '@/lib/runbooks/versioning';
import { assertCapability } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

vi.mock('@/lib/rbac', () => ({
  assertCapability: vi.fn().mockResolvedValue({ id: 'user_1', email: 'test@opsknight.com' }),
}));

vi.mock('@/lib/runbooks/lifecycle', () => ({
  checkRunbookDeleteEligibility: vi.fn(),
  deleteRunbook: vi.fn(),
  duplicateRunbook: vi.fn(),
  restoreRunbook: vi.fn(),
}));

vi.mock('@/lib/runbooks/versioning', () => ({
  archiveRunbook: vi.fn(),
  cloneVersionToDraft: vi.fn(),
  createRunbook: vi.fn(),
  publishDraftVersion: vi.fn(),
  updateDraftVersion: vi.fn(),
  updateRunbookMetadata: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

import type { Runbook } from '@prisma/client';

describe('Runbook Server Actions Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('restoreRunbookAction', () => {
    it('asserts capability and calls restoreRunbook', async () => {
      const validCuid = 'clh1234567890123456789012';
      vi.mocked(restoreRunbook).mockResolvedValueOnce({
        id: validCuid,
      } as unknown as Runbook);

      const result = await restoreRunbookAction(validCuid);

      expect(assertCapability).toHaveBeenCalled();
      expect(restoreRunbook).toHaveBeenCalledWith(validCuid, 'user_1');
      expect(revalidatePath).toHaveBeenCalledWith('/runbooks');
      expect(revalidatePath).toHaveBeenCalledWith(`/runbooks/${validCuid}`);
      expect(result).toEqual({ success: true, id: validCuid });
    });
  });

  describe('checkRunbookDeleteEligibilityAction', () => {
    it('asserts read capability and returns eligibility status', async () => {
      const validCuid = 'clh1234567890123456789012';
      const eligibility = {
        canDelete: true,
        hasExecutions: false,
        hasBindings: false,
        hasPublishedVersions: false,
        executionCount: 0,
        bindingCount: 0,
        publishedVersionCount: 0,
      };
      vi.mocked(checkRunbookDeleteEligibility).mockResolvedValueOnce(eligibility);

      const result = await checkRunbookDeleteEligibilityAction(validCuid);

      expect(assertCapability).toHaveBeenCalled();
      expect(checkRunbookDeleteEligibility).toHaveBeenCalledWith(validCuid);
      expect(result).toEqual(eligibility);
    });
  });

  describe('deleteRunbookAction', () => {
    it('asserts capability and calls deleteRunbook with confirmation text', async () => {
      const validCuid = 'clh1234567890123456789012';
      vi.mocked(deleteRunbook).mockResolvedValueOnce({ id: validCuid } as unknown as Runbook);

      const result = await deleteRunbookAction(validCuid, 'draft-slug');

      expect(assertCapability).toHaveBeenCalled();
      expect(deleteRunbook).toHaveBeenCalledWith(validCuid, 'user_1', 'draft-slug');
      expect(revalidatePath).toHaveBeenCalledWith('/runbooks');
      expect(result).toEqual({ success: true, id: validCuid });
    });
  });

  describe('duplicateRunbookAction', () => {
    it('asserts capability, duplicates runbook, and redirects to new runbook', async () => {
      const validCuid = 'clh1234567890123456789012';
      const newCuid = 'clh9876543210987654321098';
      vi.mocked(duplicateRunbook).mockResolvedValueOnce({ id: newCuid } as unknown as Awaited<ReturnType<typeof duplicateRunbook>>);

      await duplicateRunbookAction(validCuid);

      expect(assertCapability).toHaveBeenCalled();
      expect(duplicateRunbook).toHaveBeenCalledWith(validCuid, 'user_1');
      expect(revalidatePath).toHaveBeenCalledWith('/runbooks');
      expect(redirect).toHaveBeenCalledWith(`/runbooks/${newCuid}`);
    });
  });

  describe('archiveRunbookAction', () => {
    it('asserts capability, archives runbook, and redirects to library', async () => {
      const validCuid = 'clh1234567890123456789012';
      vi.mocked(archiveRunbook).mockResolvedValueOnce({ id: validCuid } as unknown as Runbook);

      await archiveRunbookAction(validCuid);

      expect(assertCapability).toHaveBeenCalled();
      expect(archiveRunbook).toHaveBeenCalledWith(validCuid, 'user_1');
      expect(revalidatePath).toHaveBeenCalledWith('/runbooks');
      expect(redirect).toHaveBeenCalledWith('/runbooks');
    });
  });
});
