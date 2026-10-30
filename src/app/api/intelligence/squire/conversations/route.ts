import { jsonOk } from '@/lib/api-response';
import { conversationActor, NO_STORE } from '@/lib/intelligence/conversations/http';
import { deleteAllConversations, listConversations } from '@/lib/intelligence/conversations/store';

export const dynamic = 'force-dynamic';

/** GET: the signed-in person's saved assistant conversations, newest first. */
export async function GET(request: Request) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  return jsonOk({ conversations: await listConversations(actor.id) }, 200, NO_STORE);
}

/** DELETE: removes all of the signed-in person's saved conversations. */
export async function DELETE(request: Request) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  return jsonOk({ deleted: await deleteAllConversations(actor.id) }, 200, NO_STORE);
}
