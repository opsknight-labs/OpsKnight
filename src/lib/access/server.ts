import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import type { TeamRole } from '@prisma/client';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { roleLabel, type AppRole, type Capability } from '@/lib/authorization';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { effectiveAccessSelect, resolveEffectiveAccess } from '@/lib/access/effective';
import { getAccessControlSettings } from '@/lib/access/settings';
import {
  resolvePageAccess,
  ruleAllows,
  type AccessResourceType,
  type PageAccessRule,
} from '@/lib/access/pages';
import { describeRequirement, type Requirement } from '@/lib/access/catalog';

export type AccessTeam = { id: string; name: string; role: TeamRole };

/** Serializable snapshot of someone's access, shared with client components. */
export type AccessSnapshot = {
  userId: string;
  baseRole: AppRole;
  role: AppRole;
  roleLabel: string;
  roleSource: 'MANUAL' | 'OIDC' | 'SCIM';
  capabilities: Capability[];
  customRole: { id: string; name: string } | null;
  teams: AccessTeam[];
  grants: {
    id: string;
    role: AppRole | null;
    incidentId: string | null;
    expiresAt: string;
    source: string;
    reason: string;
  }[];
  settings: {
    requestsEnabled: boolean;
    breakGlassEnabled: boolean;
    breakGlassMaxMinutes: number;
    selfApprovalAllowed: boolean;
  };
};

/** Request-scoped, always read from the database (never from the session token). */
export const getAccessSnapshot = cache(async (): Promise<AccessSnapshot | null> => {
  const context = await getRequestActorContext();
  if (!context) return null;
  const settings = await getAccessControlSettings();
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: context.user.id },
    select: {
      id: true,
      role: true,
      roleSource: true,
      teamMemberships: {
        select: { role: true, team: { select: { id: true, name: true } } },
        orderBy: { team: { name: 'asc' } },
      },
      customRole: effectiveAccessSelect(now).customRole,
      accessGrants: {
        where: { revokedAt: null, expiresAt: { gt: now } },
        select: {
          id: true,
          role: true,
          incidentId: true,
          expiresAt: true,
          revokedAt: true,
          source: true,
          reason: true,
        },
        orderBy: { expiresAt: 'asc' },
      },
    },
  });
  if (!user) return null;
  const access = resolveEffectiveAccess(
    { role: user.role as AppRole, customRole: user.customRole, accessGrants: user.accessGrants },
    settings,
    now
  );
  return {
    userId: user.id,
    baseRole: access.baseRole,
    role: access.role,
    roleLabel: roleLabel(access.role),
    roleSource: user.roleSource,
    capabilities: [...access.capabilities].sort(),
    customRole: access.customRole,
    teams: user.teamMemberships.map(membership => ({
      id: membership.team.id,
      name: membership.team.name,
      role: membership.role,
    })),
    grants: user.accessGrants.map(grant => ({
      id: grant.id,
      role: grant.role as AppRole | null,
      incidentId: grant.incidentId,
      expiresAt: grant.expiresAt.toISOString(),
      source: grant.source,
      reason: grant.reason,
    })),
    settings: {
      requestsEnabled: settings.requestsEnabled,
      breakGlassEnabled: settings.breakGlassEnabled,
      breakGlassMaxMinutes: settings.breakGlassMaxMinutes,
      selfApprovalAllowed: settings.selfApprovalAllowed,
    },
  };
});

export async function currentPathname(): Promise<string> {
  try {
    return (await headers()).get('x-opsknight-pathname') ?? '/';
  } catch {
    return '/';
  }
}

export type Grantor = { id: string; name: string | null; email: string };

const MAX_GRANTORS = 5;

/** People who can grant access: owners/admins of the team when known, otherwise org admins. */
export async function findGrantors(opts: {
  grantor?: PageAccessRule['grantor'];
  teamId?: string | null;
}): Promise<{ kind: 'team_owner' | 'org_admin'; teamName?: string; people: Grantor[] }> {
  if (opts.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: opts.teamId },
      select: {
        name: true,
        members: {
          // Read-only Auditors cannot manage teams even when they are team owners.
          where: {
            role: { in: ['OWNER', 'ADMIN'] },
            user: { status: 'ACTIVE', role: { not: 'AUDITOR' } },
          },
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          take: MAX_GRANTORS,
        },
      },
    });
    if (team && team.members.length > 0) {
      return {
        kind: 'team_owner',
        teamName: team.name,
        people: team.members.map(member => member.user),
      };
    }
  }
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: MAX_GRANTORS,
  });
  return { kind: 'org_admin', people: admins };
}

const DENIAL_DEDUPE_MS = 10 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 5_000;
const recentDenials = new Map<string, number>();

/**
 * Records an access denial in the audit log. Repeated denials for the same person, page and
 * requirement are collapsed for ten minutes so the log stays useful and cannot be flooded.
 */
export async function recordAccessDenied(input: {
  userId: string;
  path: string;
  requiredCapabilities?: readonly Capability[];
  reason: string;
  resource?: { type: AccessResourceType | string; id?: string | null };
  channel?: 'PAGE' | 'ACTION' | 'API' | 'CHATOPS' | 'MCP';
}): Promise<void> {
  const key = [
    input.userId,
    input.path,
    input.reason,
    input.resource?.id ?? '',
    (input.requiredCapabilities ?? []).join(','),
  ].join('|');
  const now = Date.now();
  const last = recentDenials.get(key);
  if (last && now - last < DENIAL_DEDUPE_MS) return;
  if (recentDenials.size >= MAX_DEDUPE_ENTRIES) {
    for (const [entry, at] of recentDenials) {
      if (now - at >= DENIAL_DEDUPE_MS) recentDenials.delete(entry);
    }
    if (recentDenials.size >= MAX_DEDUPE_ENTRIES) recentDenials.clear();
  }
  recentDenials.set(key, now);
  try {
    await logAudit({
      action: 'access.denied',
      entityType: 'ACCESS_DECISION',
      entityId: input.resource?.id ?? null,
      actorId: input.userId,
      details: {
        path: input.path,
        reason: input.reason,
        channel: input.channel ?? 'PAGE',
        requiredCapabilities: [...(input.requiredCapabilities ?? [])],
        ...(input.resource ? { resourceType: input.resource.type } : {}),
      },
    });
  } catch (error) {
    logger.warn('[Access] Could not record access denial', { error });
  }
}

/** Test helper. */
export function resetAccessDenialDedupe() {
  recentDenials.clear();
}

/**
 * Page guard. Every page passes its own route pattern (for example `/incidents/[id]`), so the
 * rule is deterministic and never depends on request headers. Unauthenticated people are sent
 * to sign in; people without the page permission get the 403 Access denied page, which
 * explains what is required and lets them request it.
 */
export async function requirePageAccess(route: string): Promise<void> {
  const rule = resolvePageAccess(route);
  // Pages open to everyone signed in keep their own session handling.
  if (!rule?.anyOf?.length) return;
  const { getUserPermissions } = await import('@/lib/rbac');
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) {
    const path = await currentPathname();
    redirect(`/login?callbackUrl=${encodeURIComponent(path === '/' ? route : path)}`);
  }
  if (!ruleAllows(rule, permissions.capabilities)) {
    const path = await currentPathname();
    await recordAccessDenied({
      userId: permissions.id,
      path: path === '/' ? route : path,
      requiredCapabilities: rule?.anyOf,
      reason: 'MISSING_CAPABILITY',
    });
    forbidden();
  }
}

/** Page guard plus the person's full access snapshot, for pages that display access. */
export async function requirePageAccessSnapshot(route: string): Promise<AccessSnapshot> {
  await requirePageAccess(route);
  const snapshot = await getAccessSnapshot();
  if (!snapshot) redirect(`/login?callbackUrl=${encodeURIComponent(route)}`);
  return snapshot;
}

/** Resource-level denial (for example an incident outside your teams): 403 without details. */
export async function denyResourceAccess(input: {
  resource: AccessResourceType;
  id: string;
  reason?: string;
}): Promise<never> {
  const snapshot = await getAccessSnapshot();
  const path = await currentPathname();
  if (snapshot) {
    await recordAccessDenied({
      userId: snapshot.userId,
      path,
      reason: input.reason ?? 'RESOURCE_OUT_OF_SCOPE',
      resource: { type: input.resource, id: input.id },
      requiredCapabilities: resolvePageAccess(path)?.anyOf,
    });
  }
  forbidden();
}

export type AccessExplanation = {
  path: string;
  label: string;
  requirement: Requirement | null;
  /** True when the person has the page permission but not access to this specific item. */
  resourceDenied: boolean;
  resourceType: AccessResourceType | null;
  resourceId: string | null;
  owningTeam: { id: string; name: string } | null;
  grantors: Awaited<ReturnType<typeof findGrantors>>;
  snapshot: AccessSnapshot | null;
  /** Permanent role changes are possible (role not managed by the identity provider). */
  canRequestOrgRole: boolean;
  /** The person is already in the owning team, so joining it would not help (private item). */
  alreadyInOwningTeam: boolean;
  suggestedRole: AppRole | null;
};

const ROLE_ORDER: AppRole[] = ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN'];

/**
 * Owning team for a resource the person was denied. Only the team is revealed (so they know
 * whom to ask), never the resource title or contents.
 */
async function owningTeamFor(
  resource: AccessResourceType | undefined,
  id: string | undefined
): Promise<{ id: string; name: string } | null> {
  if (!resource || !id) return null;
  try {
    if (resource === 'incident' || resource === 'postmortem') {
      const incident = await prisma.incident.findUnique({
        where: { id },
        select: {
          team: { select: { id: true, name: true } },
          service: { select: { team: { select: { id: true, name: true } } } },
        },
      });
      return incident?.service.team ?? incident?.team ?? null;
    }
    if (resource === 'service') {
      const service = await prisma.service.findUnique({
        where: { id },
        select: { team: { select: { id: true, name: true } } },
      });
      return service?.team ?? null;
    }
    if (resource === 'team') {
      return await prisma.team.findUnique({ where: { id }, select: { id: true, name: true } });
    }
  } catch {
    return null;
  }
  return null;
}

function resourceIdFromPath(rulePattern: string, path: string): string | undefined {
  const pattern = rulePattern.split('/').filter(Boolean);
  const raw = path.split('?')[0].split('/').filter(Boolean);
  // Mobile routes (/m/...) mirror desktop routes.
  const segments = raw[0] === 'm' ? raw.slice(1) : raw;
  const index = pattern.findIndex(segment => segment.startsWith('['));
  return index >= 0 ? segments.at(index) : undefined;
}

/** Explains access for `path` for the signed-in person (used by the 403 page). */
export async function explainAccessForPath(rawPath: string): Promise<AccessExplanation> {
  const path = rawPath.startsWith('/') && !rawPath.startsWith('//') ? rawPath.slice(0, 500) : '/';
  const snapshot = await getAccessSnapshot();
  const rule = resolvePageAccess(path);
  const pageAllowed = snapshot ? ruleAllows(rule, snapshot.capabilities) : false;
  const resourceDenied = Boolean(snapshot && pageAllowed && rule?.resource);
  const resourceId =
    resourceDenied && rule ? (resourceIdFromPath(rule.pattern, path) ?? null) : null;
  const owningTeam = resourceDenied
    ? await owningTeamFor(rule?.resource, resourceId ?? undefined)
    : null;
  const requirement = rule?.anyOf?.length ? describeRequirement(rule.anyOf) : null;
  const grantors = await findGrantors({
    grantor: rule?.grantor,
    teamId: owningTeam?.id ?? null,
  });
  const currentRank = snapshot ? ROLE_ORDER.indexOf(snapshot.role) : -1;
  const alreadyInOwningTeam = Boolean(
    owningTeam && snapshot?.teams.some(team => team.id === owningTeam.id)
  );
  // Item-level denials are lifted by organization-wide access (Responder) or by joining the
  // owning team; page-level denials by the least privileged role that grants the page.
  const suggestedRole = resourceDenied
    ? currentRank < ROLE_ORDER.indexOf('RESPONDER')
      ? ('RESPONDER' as const)
      : null
    : requirement
      ? (requirement.roles.find(role => ROLE_ORDER.indexOf(role) > currentRank) ??
        requirement.roles[0] ??
        null)
      : null;
  return {
    path,
    label: rule?.label ?? 'This page',
    requirement,
    resourceDenied,
    resourceType: rule?.resource ?? null,
    resourceId,
    owningTeam,
    grantors,
    snapshot,
    canRequestOrgRole: Boolean(snapshot && snapshot.roleSource === 'MANUAL'),
    alreadyInOwningTeam,
    suggestedRole,
  };
}
