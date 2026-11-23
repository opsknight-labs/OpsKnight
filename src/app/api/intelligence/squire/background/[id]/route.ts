import { jsonOk } from '@/lib/api-response';
import { cancelBackgroundTurn } from '@/lib/intelligence/conversations/background';
import {
  conversationActor,
  denyConversation,
  NO_STORE,
} from '@/lib/intelligence/conversations/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** DELETE: cancels one of the signed-in person's queued or running background answers. */
export async function DELETE(request: Request, context: Context) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!VALID_ID.test(id) || !(await cancelBackgroundTurn(actor.id, id)))
    return denyConversation(404, 'Nothing to cancel');
  return jsonOk({ cancelled: true }, 200, NO_STORE);
}
