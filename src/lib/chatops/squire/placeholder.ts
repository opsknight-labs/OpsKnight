import 'server-only';
import prisma from '@/lib/prisma';

/**
 * The progress message an earlier attempt of this queued answer already posted, so a retry edits it instead
 * of posting another. It lives on the intent row until the answer is recorded over it.
 */
export async function recalledPlaceholder(intentId: string | undefined): Promise<string | null> {
  if (!intentId) return null;
  const row = await prisma.chatOpsIntent
    .findUnique({ where: { id: intentId }, select: { responsePayload: true } })
    .catch(() => null);
  const value = (row?.responsePayload as { squirePlaceholder?: unknown } | null)?.squirePlaceholder;
  return typeof value === 'string' && value ? value : null;
}

export async function rememberPlaceholder(intentId: string | undefined, id: string): Promise<void> {
  if (!intentId) return;
  await prisma.chatOpsIntent
    .updateMany({
      where: { id: intentId, status: 'EFFECT_PROCESSING' },
      data: { responsePayload: { squirePlaceholder: id } },
    })
    .catch(() => undefined);
}
