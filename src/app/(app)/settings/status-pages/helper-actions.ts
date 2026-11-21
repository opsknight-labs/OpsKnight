'use server';

import * as z from 'zod/v3';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { loadStatusDrafts } from '@/lib/intelligence/helpers/status-draft-loader';
import type { StatusDraft } from '@/lib/intelligence/helpers/status-draft';

const idSchema = z.string().min(1).max(64);

/**
 * Status-update drafts for open incidents that affect this page. A helper, never a gate: a denied reader, a
 * switched-off feature or a failed read all answer "nothing to draft". Nothing is saved or published here.
 * With `incidentId` (the incident page's "Post status update"), only that incident's draft.
 */
export async function loadStatusDraftsAction(
  statusPageId: unknown,
  incidentId?: unknown
): Promise<StatusDraft[]> {
  const id = idSchema.safeParse(statusPageId);
  const incident = idSchema.optional().safeParse(incidentId ?? undefined);
  if (!id.success || !incident.success) return [];
  try {
    // Same gate as creating an announcement.
    await assertAdmin();
    return await loadStatusDrafts(await getCurrentAuthorizationActor(), id.data, incident.data);
  } catch {
    return [];
  }
}

const cadenceSchema = z.object({
  statusPageId: idSchema,
  /** Null restores the default. */
  minutes: z.number().int().min(5).max(1440).nullable(),
});

/**
 * Minutes between status updates while an incident is open (the incident page's "next update due").
 * Internal only: it never reaches the public page, so it is written without touching `updatedAt`, which the
 * settings form uses for optimistic concurrency and publication.
 */
export async function saveUpdateCadenceAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = cadenceSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: 'Enter a whole number of minutes from 5 to 1440.' };
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: 'Admin access required.' };
  }
  const updated = await prisma.$executeRaw`
    UPDATE "StatusPage" SET "updateCadenceMinutes" = ${parsed.data.minutes}
    WHERE "id" = ${parsed.data.statusPageId}`;
  return updated === 1 ? { ok: true } : { ok: false, error: 'Status page not found.' };
}
