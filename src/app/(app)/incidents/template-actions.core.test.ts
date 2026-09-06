import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTemplate } from './template-actions';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { assertIncidentTemplateNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

// Mock dependencies
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Test User' }),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/unique-names', () => {
  class MockUniqueNameConflictError extends Error {
    constructor() {
      super('Duplicate name');
    }
  }
  return {
    assertIncidentTemplateNameAvailable: vi.fn(),
    UniqueNameConflictError: MockUniqueNameConflictError,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentTemplate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(callback => callback(prisma)),
  },
}));

describe('createTemplate Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new template successfully', async () => {
    // Mock name available
    (assertIncidentTemplateNameAvailable as any).mockResolvedValue('new template');
    (prisma.incidentTemplate.create as any).mockResolvedValue({
      id: 'tpl-1',
      name: 'new template',
    });

    // Mock redirect to throw so execution stops (simulating Next.js)
    // or just accept it returns undefined and check calls.
    // But createTemplate code relies on redirect interrupting flow?
    // No, it's at the end. So it's fine.

    const formData = new FormData();
    formData.append('name', 'New Template');
    formData.append('title', 'Default Title');
    formData.append('defaultUrgency', 'HIGH');
    formData.append('isPublic', 'on');

    await createTemplate(formData);

    expect(assertIncidentTemplateNameAvailable).toHaveBeenCalledWith('New Template');
    expect(prisma.incidentTemplate.create).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/incidents/templates');
    expect(redirect).toHaveBeenCalledWith('/incidents/templates');
  });

  it('redirects with error if template name already exists', async () => {
    // Mock assert to throw
    (assertIncidentTemplateNameAvailable as any).mockRejectedValue(
      new UniqueNameConflictError('incidentTemplate', 'Existing Template')
    );

    // IMPORTANT: We need redirect mock to NOT throw here to verify the call?
    // Actually, if we want to mimic Next.js, redirect throws. Use spy.
    // But in this test, if redirect mock does nothing, execution continues...
    // ...and throws "Duplicate name" again?
    // See code:
    // } catch (error) {
    //     if (error instanceof UniqueNameConflictError) {
    //         redirect(...);  <-- This returns undefined in mock
    //     }
    //     throw error; <-- This is only reached if NOT UniqueNameConflictError?
    // NO. The `if` block doesn't return (unless redirect throws/returns never).

    // So I must mock redirect to THROW an "Abort" error, or I modify the code to `return redirect(...)`
    // But `redirect` return type is never.

    // I will mock redirect to throw 'NEXT_REDIRECT'.
    const error = new Error('NEXT_REDIRECT');
    (redirect as any).mockImplementation(() => {
      throw error;
    });

    const formData = new FormData();
    formData.append('name', 'Existing Template');

    try {
      await createTemplate(formData);
    } catch (e: any) {
      expect(e.message).toBe('NEXT_REDIRECT');
    }

    expect(redirect).toHaveBeenCalledWith('/incidents/templates/create?error=duplicate-template');
    expect(prisma.incidentTemplate.create).not.toHaveBeenCalled();
  });

  it('handles optional fields correctly', async () => {
    (assertIncidentTemplateNameAvailable as any).mockResolvedValue('minimal template');
    (redirect as any).mockImplementation(() => {}); // Reset to no-op for success case

    const formData = new FormData();
    formData.append('name', 'Minimal Template');
    formData.append('title', 'Title');
    formData.append('defaultUrgency', 'LOW');

    await createTemplate(formData);

    expect(prisma.incidentTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPublic: false,
        }),
      })
    );
  });
});
