'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod/v3';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { assertCanViewService, assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { getMissingRunbookSuggestions } from '@/lib/intelligence/runbook-health/loader';
import { draftRunbookFromSuggestion } from '@/lib/intelligence/runbook-health/notes';
import { ensureUniqueSlug } from '@/lib/runbooks/lifecycle';
import { createRunbook } from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();
const keySchema = z.string().min(1).max(64);

/**
 * Opens a missing-runbook suggestion as a draft in the runbook editor. The steps are recomputed here from
 * the notes the caller may read, never taken from the browser. The draft is unpublished and unbound:
 * a person reviews, edits and publishes it through the usual flow.
 */
export async function draftRunbookFromNotesAction(serviceId: string, suggestionKey: string) {
  const id = idSchema.parse(serviceId);
  const key = keySchema.parse(suggestionKey);
  const [user, actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_MANAGE),
    getCurrentAuthorizationActor(),
    assertCanViewService(id),
  ]);
  const [suggestions, service] = await Promise.all([
    getMissingRunbookSuggestions(id, actor),
    prisma.service.findUnique({ where: { id }, select: { name: true, teamId: true } }),
  ]);
  const suggestion = suggestions.find(item => item.key === key);
  if (!suggestion || !service) {
    // The notes changed or a runbook now covers the problem: refresh so the stale suggestion goes away.
    revalidatePath(`/services/${id}`);
    return;
  }

  const draft = draftRunbookFromSuggestion(suggestion.evidence, service.name);
  const created = await createRunbook(
    {
      name: draft.name,
      slug: await ensureUniqueSlug(draft.slug),
      description: draft.description,
      ownerTeamId: service.teamId,
      definition: draft.definition,
    },
    user.id
  );
  revalidatePath('/runbooks');
  redirect(`/runbooks/${created.id}?tab=builder`);
}
