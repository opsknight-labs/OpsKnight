import 'server-only';

import prisma from '@/lib/prisma';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { businessServiceReadWhere } from '@/lib/business-services/commands';

/** Each picker loads and searches at most this many rows; typing narrows server-side. */
export const FORM_OPTION_LIMIT = 50;

export type BusinessServiceFormOptionKind = 'services' | 'users';

type Option = { id: string; name: string; hint: string | null };

/** One bounded page of picker options matching `query`, scoped to what the actor can see. */
export async function searchBusinessServiceFormOptions(
  actor: AuthorizationActor,
  kind: BusinessServiceFormOptionKind,
  query = '',
  ids?: readonly string[]
): Promise<Option[]> {
  const needle = query.trim();
  if (kind === 'services') {
    const rows = await prisma.service.findMany({
      where: {
        AND: [
          // Current members keep their names even when outside the actor's scope.
          ids ? { id: { in: [...ids] } } : serviceReadWhere(actor),
          needle ? { name: { contains: needle, mode: 'insensitive' } } : {},
        ],
      },
      orderBy: { name: 'asc' },
      take: ids ? ids.length : FORM_OPTION_LIMIT,
      select: { id: true, name: true, team: { select: { name: true } } },
    });
    return rows.map(row => ({ id: row.id, name: row.name, hint: row.team?.name ?? null }));
  }
  const rows = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(ids ? { id: { in: [...ids] } } : {}),
      ...(needle
        ? {
            OR: [
              { name: { contains: needle, mode: 'insensitive' } },
              { email: { contains: needle, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: ids ? ids.length : FORM_OPTION_LIMIT,
    select: { id: true, name: true, email: true },
  });
  return rows.map(row => ({ id: row.id, name: row.name, hint: row.email }));
}

/** First page of each picker plus the current selection, so selected rows always have names. */
export async function loadBusinessServiceFormOptions(
  actor: AuthorizationActor,
  selected: {
    serviceIds?: readonly string[];
    userIds?: readonly string[];
    /** The business service being edited; left out of its own dependency choices. */
    businessServiceId?: string;
    /** Current dependencies, kept with their names even when outside the first page. */
    dependsOn?: readonly Option[];
  } = {}
) {
  const [
    services,
    selectedServices,
    teams,
    users,
    selectedUsers,
    businessServices,
    escalationPolicies,
  ] = await Promise.all([
    searchBusinessServiceFormOptions(actor, 'services'),
    selected.serviceIds?.length
      ? searchBusinessServiceFormOptions(actor, 'services', '', selected.serviceIds)
      : [],
    prisma.team.findMany({
      where: teamReadWhere(actor),
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
    searchBusinessServiceFormOptions(actor, 'users'),
    selected.userIds?.length
      ? searchBusinessServiceFormOptions(actor, 'users', '', selected.userIds)
      : [],
    prisma.businessService.findMany({
      where: {
        AND: [
          businessServiceReadWhere(actor),
          selected.businessServiceId ? { id: { not: selected.businessServiceId } } : {},
        ],
      },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
    prisma.escalationPolicy.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);
  const merge = (first: Option[], extra: Option[]) => {
    const known = new Set(first.map(option => option.id));
    return [...first, ...extra.filter(option => !known.has(option.id))];
  };
  return {
    services: merge(services, selectedServices),
    teams,
    escalationPolicies,
    users: merge(users, selectedUsers),
    businessServices: merge(
      businessServices.map(row => ({ ...row, hint: null })),
      [...(selected.dependsOn ?? [])]
    ),
  };
}
