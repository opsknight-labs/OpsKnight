'use server';

import { revalidatePath } from 'next/cache';
import { z, ZodError } from 'zod/v3';

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

/** Every client-supplied argument is parsed strictly before authorization and mutation. */
const recordId = z.string().trim().min(1).max(64);
const decisionInput = z
  .object({
    approve: z.boolean(),
    note: z.string().max(1000).optional(),
    durationMinutes: z.number().int().positive().nullable().optional(),
  })
  .strict();
const breakGlassInput = z
  .object({
    reason: z.string().max(1000),
    minutes: z.number().int().min(1).max(1440),
    incidentId: recordId.nullable().optional(),
  })
  .strict();

function failure(error: unknown): AccessActionResult {
  if (error instanceof ZodError)
    return {
      ok: false,
      error: 'Please check your input and try again.',
      code: 'VALIDATION_FAILED',
    };
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
    const id = recordId.parse(requestId);
    const user = await getCurrentUser();
    await cancelAccessRequest(user.id, id);
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
    const id = recordId.parse(requestId);
    const body = decisionInput.parse(decision);
    const user = await getCurrentUser();
    await decideAccessRequest(
      {
        id: user.id,
        isOrgAdmin: capabilitiesOf(user).includes(CAPABILITIES.ADMIN_MANAGE),
        canManageTeams: capabilitiesOf(user).includes(CAPABILITIES.TEAM_ADMINISTER_SCOPED),
        recentlyAuthenticated: await hasRecentAuthentication(),
      },
      id,
      body
    );
    revalidateAccess();
    revalidatePath('/teams');
    revalidatePath('/users');
    return { ok: true, message: body.approve ? 'Access granted.' : 'Request declined.' };
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
    const body = breakGlassInput.parse(input);
    const user = await getCurrentUser();
    if (!(await hasRecentAuthentication())) {
      return {
        ok: false,
        code: 'STEP_UP_REQUIRED',
        error: 'For your security, sign in again before using emergency access.',
      };
    }
    const grant = await activateBreakGlass({ userId: user.id, ...body });
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
    const id = recordId.parse(grantId);
    const why = z.string().trim().min(1).max(500).parse(reason);
    const user = await getCurrentUser();
    await revokeAccessGrant({
      grantId: id,
      actorId: user.id,
      reason: why,
      isAdmin: capabilitiesOf(user).includes(CAPABILITIES.ADMIN_MANAGE),
    });
    revalidateAccess();
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Access ended.' };
  } catch (error) {
    return failure(error);
  }
}
