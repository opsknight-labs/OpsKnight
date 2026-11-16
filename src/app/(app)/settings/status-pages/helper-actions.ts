'use server';

import * as z from 'zod/v3';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { loadStatusDrafts } from '@/lib/intelligence/helpers/status-draft-loader';
import type { StatusDraft } from '@/lib/intelligence/helpers/status-draft';

const idSchema = z.string().min(1).max(64);

/**
 * Status-update drafts for open incidents that affect this page. A helper, never a gate: a denied reader, a
 * switched-off feature or a failed read all answer "nothing to draft". Nothing is saved or published here.
 */
export async function loadStatusDraftsAction(statusPageId: unknown): Promise<StatusDraft[]> {
  const id = idSchema.safeParse(statusPageId);
  if (!id.success) return [];
  try {
    // Same gate as creating an announcement.
    await assertAdmin();
    return await loadStatusDrafts(await getCurrentAuthorizationActor(), id.data);
  } catch {
    return [];
  }
}
