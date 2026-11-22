'use server';

import { z } from 'zod/v4';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  listSquireActionHistory,
  type ActionHistoryPage,
} from '@/lib/intelligence/squire/actions/history';

const inputSchema = z.object({
  scope: z.string().max(16).optional(),
  status: z.string().max(16).optional(),
  cursor: z.string().max(64).optional(),
});

/** The next page of the Squire action history; scoping is enforced by the view, not the caller. */
export async function loadMoreSquireActions(input: unknown): Promise<ActionHistoryPage | null> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return null;
  return listSquireActionHistory(await getCurrentAuthorizationActor(), parsed.data);
}
