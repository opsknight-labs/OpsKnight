import 'server-only';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { loadActiveEdges } from '@/lib/intelligence/dependencies/service';
import { applyStatusPageConfigurationChange } from '@/lib/status-pages/publish-configuration';
import { createBusinessService } from './commands';
import { setBusinessServiceSubscribers } from './stakeholder-comms';

const id = z.string().trim().min(1).max(100);

export const SetupInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().default(null),
    memberServiceIds: z.array(id).max(200).default([]),
    ownerTeamId: id.nullable().default(null),
    criticality: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).nullable().default(null),
    /** Lowest incident urgency that counts as impact; null keeps the tier default. */
    impactMinUrgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().default(null),
    /** Most severe priority that still counts, e.g. "P2"; null keeps the tier default. */
    impactMaxPriority: z
      .string()
      .regex(/^P[1-5]$/)
      .nullable()
      .default(null),
    statusPageIds: z.array(id).max(20).default([]),
    subscriberTeamIds: z.array(id).max(200).default([]),
    subscribeAllUsers: z.boolean().default(false),
  })
  .strict();

export type SetupInput = z.input<typeof SetupInputSchema>;

/**
 * Services the chosen members depend on (one hop upstream over active dependency edges) that
 * are not chosen yet, most depended-on first: likely parts of the same capability.
 */
export function suggestMemberAdditions(
  selectedIds: readonly string[],
  edges: ReadonlyArray<{ upstreamServiceId: string; downstreamServiceId: string }>,
  limit = 10
): string[] {
  const selected = new Set(selectedIds);
  const counts = new Map<string, number>();
  for (const edge of edges)
    if (selected.has(edge.downstreamServiceId) && !selected.has(edge.upstreamServiceId))
      counts.set(edge.upstreamServiceId, (counts.get(edge.upstreamServiceId) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([serviceId]) => serviceId);
}

/** Dependency-suggested members, limited to services the actor can see. */
export async function loadMemberSuggestions(
  selectedIds: readonly string[],
  visibleServiceIds: ReadonlySet<string>
) {
  if (!selectedIds.length) return [];
  const edges = await loadActiveEdges();
  return suggestMemberAdditions(
    selectedIds,
    edges.filter(edge => visibleServiceIds.has(edge.upstreamServiceId))
  );
}

/**
 * The setup wizard's final step. The business service (members, owner, criticality and
 * thresholds) is created atomically; subscribers and status pages follow, and a failure there
 * is reported without undoing the business service.
 */
export async function createBusinessServiceFromSetup(
  raw: SetupInput,
  context: { actor: AuthorizationActor & { name?: string | null; email?: string | null } }
): Promise<{ id: string; warnings: string[] }> {
  const input = SetupInputSchema.parse(raw);
  const canManagePages = authorize({
    actor: context.actor,
    action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  }).allowed;
  if (input.statusPageIds.length && !canManagePages)
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only status page managers can add it to a status page.',
    });

  const created = await prisma.$transaction(async tx => {
    const row = await createBusinessService(
      {
        name: input.name,
        description: input.description,
        ownerTeamId: input.ownerTeamId,
        memberServiceIds: input.memberServiceIds,
      },
      { actor: context.actor },
      tx
    );
    await tx.businessService.update({
      where: { id: row.id },
      data: {
        criticality: input.criticality,
        impactMinUrgency: input.impactMinUrgency,
        impactMaxPriority: input.impactMaxPriority,
      },
    });
    return row;
  });

  const warnings: string[] = [];
  if (input.subscriberTeamIds.length || input.subscribeAllUsers) {
    try {
      await setBusinessServiceSubscribers(
        created.id,
        { teamIds: input.subscriberTeamIds, subscribeAllUsers: input.subscribeAllUsers },
        { actor: context.actor }
      );
    } catch {
      warnings.push('Subscribers could not be saved; add them from the business service.');
    }
  }
  for (const pageId of input.statusPageIds) {
    try {
      const current = await prisma.statusPageBusinessService.findMany({
        where: { statusPageId: pageId },
        orderBy: { order: 'asc' },
        select: { businessServiceId: true },
      });
      await applyStatusPageConfigurationChange({
        pageId,
        actor: { id: context.actor.id, name: context.actor.name, email: context.actor.email },
        patch: {},
        businessServiceIds: [...current.map(row => row.businessServiceId), created.id],
        section: 'services',
      });
    } catch {
      warnings.push('One status page could not be updated; add it from the status page settings.');
    }
  }
  return { id: created.id, warnings };
}
