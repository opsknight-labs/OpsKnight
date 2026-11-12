'use server';

import { revalidatePath } from 'next/cache';

import { CAPABILITIES, isCapability, type Capability, capabilitiesOf } from '@/lib/authorization';
import { getCurrentUser } from '@/lib/rbac';
import { AppError, toPublicAppError } from '@/lib/errors';
import { hasRecentAuthentication } from '@/lib/access/step-up';
import {
  archiveCustomRole,
  assignCustomRole,
  checkAccess,
  completeAccessReview,
  decideAccessReviewItem,
  saveCustomRole,
  startAccessReview,
  updateAccessPolicy,
  whoHasCapability,
  type AccessCheckResult,
} from '@/lib/access/admin';

type Result<T = undefined> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

function failure(error: unknown): { ok: false; error: string; code?: string } {
  const publicError = toPublicAppError(error);
  return { ok: false, error: publicError.message, code: publicError.code };
}

async function requireAccessAdmin(level: 'admin' | 'reviewer' = 'admin', stepUp = false) {
  const user = await getCurrentUser();
  const capabilities = capabilitiesOf(user);
  const allowed =
    capabilities.includes(CAPABILITIES.ADMIN_MANAGE) ||
    (level === 'reviewer' && capabilities.includes(CAPABILITIES.ACCESS_REVIEW_MANAGE));
  if (!allowed) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage:
        level === 'admin'
          ? 'Only administrators can change access settings.'
          : 'Only administrators and access reviewers can do this.',
    });
  }
  if (stepUp && !(await hasRecentAuthentication())) {
    throw new AppError({
      code: 'STEP_UP_REQUIRED',
      userMessage: 'For your security, sign in again before changing access policy or roles.',
    });
  }
  return user;
}

function revalidate() {
  revalidatePath('/settings/access/admin');
}

export async function checkAccessAction(
  input: Parameters<typeof checkAccess>[0]
): Promise<Result<AccessCheckResult>> {
  try {
    await requireAccessAdmin('reviewer');
    return { ok: true, data: await checkAccess(input) };
  } catch (error) {
    return failure(error);
  }
}

export async function whoHasCapabilityAction(capability: string) {
  try {
    await requireAccessAdmin('reviewer');
    if (!isCapability(capability)) throw new AppError({ code: 'VALIDATION_FAILED' });
    const result = await whoHasCapability(capability as Capability);
    return {
      ok: true as const,
      data: {
        roles: result.roles,
        byRole: result.byRole,
        byCustomRole: result.byCustomRole.map(user => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customRole: user.customRole?.name ?? null,
        })),
        byGrant: result.byGrant.map(grant => ({
          id: grant.id,
          role: grant.role,
          source: grant.source,
          expiresAt: grant.expiresAt.toISOString(),
          user: grant.user,
        })),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCustomRoleAction(input: {
  id?: string | null;
  name: string;
  description?: string | null;
  capabilities: string[];
}): Promise<Result> {
  try {
    const user = await requireAccessAdmin('admin', true);
    await saveCustomRole(user.id, input);
    revalidate();
    return { ok: true, message: 'Custom role saved.' };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveCustomRoleAction(id: string): Promise<Result> {
  try {
    const user = await requireAccessAdmin('admin', true);
    await archiveCustomRole(user.id, id);
    revalidate();
    return { ok: true, message: 'Custom role removed.' };
  } catch (error) {
    return failure(error);
  }
}

export async function assignCustomRoleAction(
  userId: string,
  customRoleId: string | null
): Promise<Result> {
  try {
    const user = await requireAccessAdmin('admin', true);
    await assignCustomRole(user.id, userId, customRoleId);
    revalidate();
    revalidatePath('/users');
    return { ok: true, message: customRoleId ? 'Custom role assigned.' : 'Custom role removed.' };
  } catch (error) {
    return failure(error);
  }
}

export async function startAccessReviewAction(input: {
  name: string;
  dueInDays: number | null;
}): Promise<Result> {
  try {
    const user = await requireAccessAdmin('reviewer');
    const dueAt =
      input.dueInDays && input.dueInDays > 0
        ? new Date(Date.now() + Math.min(input.dueInDays, 90) * 24 * 60 * 60 * 1000)
        : null;
    await startAccessReview(user.id, { name: input.name, dueAt });
    revalidate();
    return { ok: true, message: 'Access review started.' };
  } catch (error) {
    return failure(error);
  }
}

export async function decideAccessReviewItemAction(
  itemId: string,
  decision: 'KEEP' | 'REVOKE',
  note?: string
): Promise<Result> {
  try {
    const user = await requireAccessAdmin('reviewer');
    await decideAccessReviewItem(user.id, itemId, decision, note);
    revalidate();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function completeAccessReviewAction(reviewId: string): Promise<Result> {
  try {
    const user = await requireAccessAdmin('reviewer', true);
    const result = await completeAccessReview(user.id, reviewId);
    revalidate();
    return { ok: true, message: `Review completed. ${result.revoked} assignment(s) removed.` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateAccessPolicyAction(
  input: Parameters<typeof updateAccessPolicy>[1]
): Promise<Result> {
  try {
    const user = await requireAccessAdmin('admin', true);
    await updateAccessPolicy(user.id, input);
    revalidate();
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Access policy saved.' };
  } catch (error) {
    return failure(error);
  }
}
