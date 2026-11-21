import 'server-only';

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { parseAnalyticsParams, toAnalyticsSearchParams } from './params';

/**
 * Saved filter sets for /analytics. The stored query is always the canonical
 * string from toAnalyticsSearchParams, and every read re-parses it, so a view
 * saved before a filter changed can never carry an unvalidated value.
 */

export const MAX_ANALYTICS_VIEWS_PER_USER = 50;

const viewId = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1, 'Name is required.').max(80, 'Use 80 characters or fewer.');

export const CreateAnalyticsViewSchema = z
  .object({
    name,
    query: z.string().max(4_000),
    visibility: z.enum(['PRIVATE', 'TEAM']).default('PRIVATE'),
    teamId: viewId.nullish(),
  })
  .strict();

export type AnalyticsViewSummary = {
  id: string;
  name: string;
  query: string;
  visibility: 'PRIVATE' | 'TEAM' | 'PUBLIC';
  teamName: string | null;
  isDefault: boolean;
  emailWeekly: boolean;
  isOwner: boolean;
};

/** Re-validates a stored or submitted query; returns the canonical string. */
export function canonicalAnalyticsQuery(query: string): string {
  return toAnalyticsSearchParams(parseAnalyticsParams(new URLSearchParams(query))).toString();
}

function deny(message: string): never {
  throw new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: message });
}

function assertCan(actor: AuthorizationActor, write: boolean) {
  const action = write ? AUTHORIZATION_ACTIONS.REPORT_MANAGE : AUTHORIZATION_ACTIONS.REPORT_READ;
  if (!authorize({ actor, action }).allowed)
    deny("You don't have permission to use analytics views.");
}

function readWhere(actor: AuthorizationActor): Prisma.AnalyticsViewWhereInput {
  return {
    OR: [
      { userId: actor.id },
      ...(actor.teamIds.length
        ? [{ visibility: 'TEAM' as const, teamId: { in: [...actor.teamIds] } }]
        : []),
    ],
  };
}

/** Only the owner may change a view; others get not-found, not a hint it exists. */
async function ownView(actor: AuthorizationActor, id: string) {
  assertCan(actor, true);
  const view = await prisma.analyticsView.findFirst({
    where: { id: viewId.parse(id), userId: actor.id },
    select: { id: true },
  });
  if (!view) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'View not found.' });
  return view;
}

export async function listAnalyticsViews(
  actor: AuthorizationActor
): Promise<AnalyticsViewSummary[]> {
  assertCan(actor, false);
  const rows = await prisma.analyticsView.findMany({
    where: readWhere(actor),
    select: {
      id: true,
      name: true,
      query: true,
      visibility: true,
      userId: true,
      isDefault: true,
      emailWeekly: true,
      team: { select: { name: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    query: canonicalAnalyticsQuery(row.query),
    visibility: row.visibility,
    teamName: row.team?.name ?? null,
    isOwner: row.userId === actor.id,
    isDefault: row.userId === actor.id && row.isDefault,
    emailWeekly: row.userId === actor.id && row.emailWeekly,
  }));
}

export async function createAnalyticsView(actor: AuthorizationActor, input: unknown) {
  assertCan(actor, true);
  const data = CreateAnalyticsViewSchema.parse(input);
  const teamId = data.visibility === 'TEAM' ? data.teamId : null;
  if (data.visibility === 'TEAM' && (!teamId || !actor.teamIds.includes(teamId))) {
    deny('Choose one of your teams to share this view with.');
  }
  return prisma.$transaction(async tx => {
    const count = await tx.analyticsView.count({ where: { userId: actor.id } });
    if (count >= MAX_ANALYTICS_VIEWS_PER_USER) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: `You can save up to ${MAX_ANALYTICS_VIEWS_PER_USER} views. Delete one first.`,
      });
    }
    return tx.analyticsView.create({
      data: {
        name: data.name,
        query: canonicalAnalyticsQuery(data.query),
        visibility: data.visibility,
        teamId,
        userId: actor.id,
      },
      select: { id: true, query: true },
    });
  });
}

export async function renameAnalyticsView(actor: AuthorizationActor, id: string, newName: string) {
  const view = await ownView(actor, id);
  await prisma.analyticsView.update({
    where: { id: view.id },
    data: { name: name.parse(newName) },
  });
}

export async function deleteAnalyticsView(actor: AuthorizationActor, id: string) {
  const view = await ownView(actor, id);
  await prisma.analyticsView.delete({ where: { id: view.id } });
}

/** Pass null to clear the default. */
export async function setDefaultAnalyticsView(actor: AuthorizationActor, id: string | null) {
  assertCan(actor, true);
  const view = id ? await ownView(actor, id) : null;
  await prisma.$transaction([
    prisma.analyticsView.updateMany({
      where: { userId: actor.id, isDefault: true },
      data: { isDefault: false },
    }),
    ...(view
      ? [prisma.analyticsView.update({ where: { id: view.id }, data: { isDefault: true } })]
      : []),
  ]);
}

export async function setAnalyticsViewWeeklyEmail(
  actor: AuthorizationActor,
  id: string,
  enabled: boolean
) {
  const view = await ownView(actor, id);
  // Subscribing mid-week waits for the next weekly run instead of sending at once.
  await prisma.analyticsView.update({
    where: { id: view.id },
    data: {
      emailWeekly: z.boolean().parse(enabled),
      ...(enabled ? { lastSentAt: new Date() } : {}),
    },
  });
}

/** Canonical query of the user's default view, or null. One indexed lookup. */
export async function getDefaultAnalyticsViewQuery(userId: string): Promise<string | null> {
  const view = await prisma.analyticsView.findFirst({
    where: { userId, isDefault: true },
    select: { query: true },
  });
  return view ? canonicalAnalyticsQuery(view.query) : null;
}
