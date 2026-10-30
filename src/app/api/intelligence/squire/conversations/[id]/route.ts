import { jsonOk } from '@/lib/api-response';
import { conversationActor, denyConversation, NO_STORE } from '@/lib/intelligence/conversations/http';
import { deleteConversation, getConversation } from '@/lib/intelligence/conversations/store';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** GET: one of the signed-in person's conversations. Anyone else's is reported as not found. */
export async function GET(request: Request, context: Context) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!VALID_ID.test(id)) return denyConversation(404, 'Conversation not found');
  const conversation = await getConversation(actor.id, id);
  return conversation ? jsonOk({ conversation }, 200, NO_STORE) : denyConversation(404, 'Conversation not found');
}

/** DELETE: removes one of the signed-in person's conversations. */
export async function DELETE(request: Request, context: Context) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!VALID_ID.test(id) || !(await deleteConversation(actor.id, id))) return denyConversation(404, 'Conversation not found');
  return jsonOk({ deleted: true }, 200, NO_STORE);
}
