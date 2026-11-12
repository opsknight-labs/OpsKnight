'use server';

import { revalidatePath } from 'next/cache';

import { CAPABILITIES, capabilitiesOf } from '@/lib/authorization';
import { getCurrentUser } from '@/lib/rbac';
import { toPublicAppError } from '@/lib/errors';
import {
  cancelAccessRequest,
  createAccessRequest,
  decideAccessRequest,
  type AccessRequestInput,
} from '@/lib/access/requests';
import { activateBreakGlass, revokeAccessGrant } from '@/lib/access/grants';
import { hasRecentAuthentication } from '@/lib/access/step-up';

export type AccessActionResult =
  { ok: true; message?: string; id?: string } | { ok: false; error: string; code?: string };

function failure(error: unknown): AccessActionResult {
  const publicError = toPublicAppError(error);
  return { ok: false, error: publicError.message, code: publicError.code };
}

function revalidateAccess() {
  revalidatePath('/settings/access');
  revalidatePath('/settings/access/requests');
  revalidatePath('/settings/access/admin');
}

export async function requestAccessAction(input: AccessRequestInput): Promise<AccessActionResult> {
  try {
    const user = await getCurrentUser();
    const request = await createAccessRequest(user.id, input);
    revalidateAccess();
    return {
      ok: true,
      id: request.id,
      message: 'Request sent. You will get a notification when it is reviewed.',
    };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelAccessRequestAction(requestId: string): Promise<AccessActionResult> {
  try {
    const user = await getCurrentUser();
    await cancelAccessRequest(user.id, requestId);
    revalidateAccess();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function decideAccessRequestAction(
  requestId: string,
  decision: { approve: boolean; note?: string; durationMinutes?: number | null }
): Promise<AccessActionResult> {
  try {
    const user = await getCurrentUser();
    await decideAccessRequest(
      {
        id: user.id,
        isOrgAdmin: capabilitiesOf(user).includes(CAPABILITIES.ADMIN_MANAGE),
        recentlyAuthenticated: await hasRecentAuthentication(),
      },
      requestId,
      decision
    );
    revalidateAccess();
    revalidatePath('/teams');
    revalidatePath('/users');
    return { ok: true, message: decision.approve ? 'Access granted.' : 'Request declined.' };
  } catch (error) {
    return failure(error);
  }
}

export async function activateBreakGlassAction(input: {
  reason: string;
  minutes: number;
  incidentId?: string | null;
}): Promise<AccessActionResult> {
  try {
    const user = await getCurrentUser();
    if (!(await hasRecentAuthentication())) {
      return {
        ok: false,
        code: 'STEP_UP_REQUIRED',
        error: 'For your security, sign in again before using emergency access.',
      };
    }
    const grant = await activateBreakGlass({ userId: user.id, ...input });
    revalidateAccess();
    revalidatePath('/', 'layout');
    return {
      ok: true,
      id: grant.id,
      message: 'Emergency Responder access is active. Administrators have been notified.',
    };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeAccessGrantAction(
  grantId: string,
  reason = 'Ended early'
): Promise<AccessActionResult> {
  try {
    const user = await getCurrentUser();
    await revokeAccessGrant({
      grantId,
      actorId: user.id,
      reason,
      isAdmin: capabilitiesOf(user).includes(CAPABILITIES.ADMIN_MANAGE),
    });
    revalidateAccess();
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Access ended.' };
  } catch (error) {
    return failure(error);
  }
}
