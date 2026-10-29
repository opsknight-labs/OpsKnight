import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import type { V2RouteContext, V2RouteHandlerResult } from './endpoint';
import { requireUserAdministrator } from '@/lib/users/administration';
import { prepareUserInvitation, type issueUserInvitation } from '@/lib/users/invitations';
export const invitationUserParams = z.object({ id: z.string().cuid() }).strict();
const preparationSchema = z
  .object({ emailProviders: z.array(z.string().min(1)), appUrl: z.string().url().max(2048) })
  .strict();
/** An unavailable provider must not prevent replaying a previously committed safe receipt. */
export async function prepareInvitationRequest() {
  try {
    return await prepareUserInvitation();
  } catch {
    return null;
  }
}
export function preparedInvitation(context: Pick<V2RouteContext, 'prepared'>) {
  const parsed = preparationSchema.safeParse(context.prepared);
  if (!parsed.success)
    throw new AppError({
      code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
      userMessage:
        'Invitation configuration is unavailable. Try again after restoring the control plane.',
    });
  return parsed.data;
}
export async function invitationReplayGuard(context: Pick<V2RouteContext, 'actor' | 'tx'>) {
  if (!context.tx) throw new Error('Invitation replay requires a transaction.');
  await requireUserAdministrator(context.tx, context.actor);
}
type InvitationResult = Awaited<ReturnType<typeof issueUserInvitation>>;
/** Initial manual capabilities are disclosed once; stored receipts can never redisclose them. */
export function persistInvitationReceipt(
  result: V2RouteHandlerResult<InvitationResult>
): V2RouteHandlerResult<InvitationResult> {
  if (result instanceof Response || !result.data) return result;
  return {
    ...result,
    data: {
      ...result.data,
      inviteUrl: null,
      disclosure: result.data.inviteUrl ? 'ALREADY_DISCLOSED' : result.data.disclosure,
    },
  };
}
