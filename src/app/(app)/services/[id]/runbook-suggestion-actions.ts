'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod/v3';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { assertCanViewService, assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { getMissingRunbookSuggestions } from '@/lib/intelligence/runbook-health/view';
import { draftRunbookFromNotes } from '@/lib/intelligence/runbook-health/notes';
import { ensureUniqueSlug } from '@/lib/runbooks/lifecycle';
import { createRunbook } from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();
const insightIdSchema = z.string().min(1).max(64);

/**
 * Opens a missing-runbook suggestion as a draft in the runbook editor. The steps are rebuilt here from the
 * stored suggestion's notes that the caller may read, never taken from the browser. The draft is unpublished and unbound:
 * a person reviews, edits and publishes it through the usual flow.
 */
export async function draftRunbookFromNotesAction(serviceId: string, insightId: string) {
  const id = idSchema.parse(serviceId);
  const suggestionId = insightIdSchema.parse(insightId);
  const [user, actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_MANAGE),
    getCurrentAuthorizationActor(),
    assertCanViewService(id),
  ]);
  const [suggestions, service] = await Promise.all([
    getMissingRunbookSuggestions(id, actor),
    prisma.service.findUnique({ where: { id }, select: { name: true, teamId: true } }),
  ]);
  const suggestion = suggestions.find(item => item.insight.id === suggestionId);
  if (!suggestion || suggestion.steps.length === 0 || !service) {
    // The notes changed or a runbook now covers the problem: refresh so the stale suggestion goes away.
    revalidatePath(`/services/${id}`);
    return;
  }

  const draft = draftRunbookFromNotes(suggestion, service.name);
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
