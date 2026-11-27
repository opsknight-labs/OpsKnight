import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import type { IncidentStatus, IncidentUrgency, Prisma } from '@prisma/client';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  incidentReadWhere,
  postmortemReadWhere,
  runbookReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';

const INSENSITIVE_MODE = 'insensitive' as const;

const INCIDENT_LIMIT = 8;

const incidentSelect = {
  id: true,
  title: true,
  status: true,
  urgency: true,
  automationSourceRestricted: true,
  automationTraces: { select: { incidentId: true }, take: 1 },
  automationDecision: { select: { incidentId: true } },
  service: { select: { id: true, name: true } },
} satisfies Prisma.IncidentSelect;

const BUSINESS_STATUS_LABEL = new Map<string, string>([
  ['OPERATIONAL', 'Operational'],
  ['DEGRADED', 'Degraded'],
  ['PARTIAL_OUTAGE', 'Partial outage'],
  ['MAJOR_OUTAGE', 'Major outage'],
  ['MAINTENANCE', 'Maintenance'],
  ['UNKNOWN', 'Unknown'],
]);

type IncidentWithService = {
  id: string;
  title: string;
  status: IncidentStatus;
  urgency: IncidentUrgency;
  automationSourceRestricted?: boolean;
  automationTraces?: Array<{ incidentId: string }>;
  automationDecision?: { incidentId: string } | null;
  service?: {
    id: string;
    name: string;
  } | null;
};

type ServiceWithTeam = {
  id: string;
  name: string;
  status?: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
};

type TeamSearchResult = {
  id: string;
  name: string;
  description?: string | null;
};

type UserSearchResult = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
};

type PolicySearchResult = {
  id: string;
  name: string;
  description?: string | null;
};

type PostmortemSearchResult = {
  id: string;
  incidentId: string;
  title: string;
  status: string;
  incident?: {
    id: string;
    title: string;
  } | null;
};

type SearchResponses = [
  IncidentWithService[],
  ServiceWithTeam[],
  TeamSearchResult[],
  UserSearchResult[],
  PolicySearchResult[],
  PostmortemSearchResult[] | [],
  Array<{ id: string; name: string; timeZone: string }>,
  Array<{ id: string; name: string; description: string }>,
  Array<{ id: string; name: string; criticality: string | null }>,
];

/** Read scope for a resource, or null when the actor may not read it at all. */
function readScope<T>(scope: () => T): T | null {
  try {
    return scope();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError('Unauthorized', 401);
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        role: true,
        status: true,
        teamMemberships: { select: { teamId: true } },
      },
    });
    if (!currentUser || currentUser.status !== 'ACTIVE') {
      return jsonError('Unauthorized', 401);
    }

    const actor: AuthorizationActor = {
      id: currentUser.id,
      role: currentUser.role,
      status: currentUser.status,
      teamIds: currentUser.teamMemberships.map(membership => membership.teamId),
    };
    const isPrivileged = hasCapability(currentUser.role, CAPABILITIES.INCIDENT_READ_ALL);
    const canReadSensitive = hasCapability(currentUser.role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
    // A result whose page answers 403 is a dead link: search only what the actor can open.
    const canReadUsers = hasCapability(currentUser.role, CAPABILITIES.USER_READ_ALL);
    const canReadPolicies = hasCapability(currentUser.role, CAPABILITIES.POLICY_READ_ALL);
    // Restricted automation-source content must not be matchable (or shown) by text.
    const unrestrictedSource = canReadSensitive
      ? {}
      : {
          automationSourceRestricted: false,
          automationDecision: { is: null },
          automationTraces: { none: {} },
        };
    const teamIds = [...actor.teamIds];
    const incidentAccess = incidentReadWhere(actor);
    const serviceAccess = serviceReadWhere(actor);
    const scheduleAccess = readScope(() => scheduleReadWhere(actor));
    const runbookAccess = readScope(() => runbookReadWhere(actor));
    // Business services follow their own read rule (service read, scoped to the actor's teams).
    const businessServiceAccess = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ })
      .allowed
      ? readScope(() => businessServiceReadWhere(actor))
      : null;

    const rate = await checkRateLimit(`api:search:user:${currentUser.id}`, 30, 60_000);
    if (!rate.allowed) {
      return jsonError('Rate limit exceeded', 429, {
        retryAfter: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)),
      });
    }

    const searchParams = req.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return jsonOk({ results: [] }, 200);
    }

    const searchTerm = query.trim();

    // Performance: Skip very short queries that would match too many results
    if (searchTerm.length < 2) {
      return jsonOk({ results: [] }, 200);
    }

    // Performance: Limit query length to prevent regex DoS
    const sanitizedTerm = searchTerm
      .slice(0, 100)
      .replace(/[%_\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (sanitizedTerm.length < 2) {
      return jsonOk({ results: [] }, 200);
    }
    const searchTermLower = sanitizedTerm.toLowerCase();

    // Performance: Limit word-based search to reduce OR conditions
    const searchWords = sanitizedTerm
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 5);
    // Every word must appear (in any of the fields): 'payment timeout' is not 'payment OR timeout'.
    const queryWords = searchWords.length > 0 ? searchWords : [sanitizedTerm];
    const has = (word: string) => ({ contains: word, mode: INSENSITIVE_MODE });
    const everyWord = <Field>(fieldsFor: (word: string) => Field[]) => ({
      AND: queryWords.map(word => ({ OR: fieldsFor(word) })),
    });
    // Run all searches in parallel for better performance
    // Note: Postmortem search is wrapped to handle missing model gracefully
    const searchPromises = [
      // Search incidents - Enhanced with multiple search strategies
      prisma.incident.findMany({
        where: {
          AND: [
            incidentAccess,
            {
              OR: [
                {
                  AND: [
                    unrestrictedSource,
                    everyWord(word => [{ title: has(word) }, { description: has(word) }]),
                  ],
                },
                { id: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
          ],
        },
        take: INCIDENT_LIMIT, // Reduced for faster response on small systems
        orderBy: [{ createdAt: 'desc' }],
        select: incidentSelect,
      }),

      // Search services
      prisma.service.findMany({
        where: {
          AND: [
            serviceAccess,
            everyWord(word => [{ name: has(word) }, { description: has(word) }]),
          ],
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          team: { select: { id: true, name: true } },
        },
      }),

      // Search teams
      prisma.team.findMany({
        where: {
          AND: [
            isPrivileged ? {} : { id: { in: teamIds } },
            everyWord(word => [{ name: has(word) }, { description: has(word) }]),
          ],
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
        },
      }),

      // Search users (skipped when the actor cannot open user pages)
      canReadUsers
        ? prisma.user.findMany({
            where: {
              AND: [
                isPrivileged
                  ? {}
                  : {
                      OR: [
                        { id: currentUser.id },
                        { teamMemberships: { some: { teamId: { in: teamIds } } } },
                      ],
                    },
                everyWord(word => [{ name: has(word) }, { email: has(word) }]),
              ],
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          })
        : Promise.resolve([]),

      // Search escalation policies (skipped when the actor cannot open policy pages)
      canReadPolicies
        ? prisma.escalationPolicy.findMany({
            where: {
              AND: [
                isPrivileged ? {} : { services: { some: { teamId: { in: teamIds } } } },
                everyWord(word => [{ name: has(word) }, { description: has(word) }]),
              ],
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              description: true,
            },
          })
        : Promise.resolve([]),

      // Search postmortems (only if Postmortem model exists)
      (async () => {
        try {
          // Check if Postmortem model exists by checking if prisma has it
          if (!prisma.postmortem) {
            return [];
          }
          return await prisma.postmortem.findMany({
            where: {
              AND: [
                // Same rule as every other postmortem read: drafts only for draft readers.
                postmortemReadWhere(actor),
                everyWord(word => [
                  { title: has(word) },
                  { summary: has(word) },
                  { rootCause: has(word) },
                  { lessons: has(word) },
                ]),
              ],
              status: { not: 'ARCHIVED' }, // Don't show archived postmortems
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              incidentId: true,
              title: true,
              status: true,
              incident: {
                select: {
                  id: true,
                  title: true,
                  automationSourceRestricted: true,
                  automationTraces: { select: { incidentId: true }, take: 1 },
                  automationDecision: { select: { incidentId: true } },
                },
              },
            },
          });
        } catch (_e) {
          // If postmortem model doesn't exist or query fails, return empty
          return [];
        }
      })(),

      // Search on-call schedules (skipped when the actor has no schedule read)
      scheduleAccess
        ? prisma.onCallSchedule.findMany({
            where: {
              AND: [scheduleAccess, everyWord(word => [{ name: has(word) }])],
            },
            take: 5,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, timeZone: true },
          })
        : Promise.resolve([]),

      // Search runbooks (skipped when the actor has no runbook read)
      runbookAccess
        ? prisma.runbook.findMany({
            where: {
              AND: [
                runbookAccess,
                { archivedAt: null },
                everyWord(word => [{ name: has(word) }, { description: has(word) }]),
              ],
            },
            take: 5,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, name: true, description: true },
          })
        : Promise.resolve([]),

      // Search business services (skipped when the actor has no service read)
      businessServiceAccess
        ? prisma.businessService.findMany({
            where: {
              AND: [
                businessServiceAccess,
                everyWord(word => [{ name: has(word) }, { description: has(word) }]),
              ],
            },
            take: 5,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, criticality: true },
          })
        : Promise.resolve([]),
    ];

    // Exact title matches rank first: the newest-first limit above must not cut an older exact match.
    const exactIncidentsPromise = prisma.incident.findMany({
      where: {
        AND: [
          incidentAccess,
          unrestrictedSource,
          { title: { equals: sanitizedTerm, mode: INSENSITIVE_MODE } },
        ],
      },
      take: INCIDENT_LIMIT,
      orderBy: [{ createdAt: 'desc' }],
      select: incidentSelect,
    });

    const [searchResults, exactIncidents] = await Promise.all([
      Promise.all(searchPromises),
      exactIncidentsPromise,
    ]);
    const [
      broadIncidents,
      services,
      teams,
      users,
      policies,
      postmortemsResult,
      schedules,
      runbooks,
      businessServices,
    ] = searchResults as SearchResponses;
    const exactIncidentIds = new Set(exactIncidents.map(incident => incident.id));
    const incidents = [
      ...exactIncidents,
      ...broadIncidents.filter(incident => !exactIncidentIds.has(incident.id)),
    ].slice(0, INCIDENT_LIMIT) as IncidentWithService[];
    // Health for the status dot, from the cached snapshot; a miss leaves the dot off.
    const businessHealth = businessServices.length
      ? await import('@/lib/business-services/health')
          .then(({ getHealthSnapshot }) => getHealthSnapshot())
          .then(snapshot => snapshot.health)
          .catch(() => null)
      : null;

    // Handle postmortems result (unwrap promise if needed)
    const postmortems = Array.isArray(postmortemsResult) ? postmortemsResult : [];

    // Format results with proper priorities (incidents first, then services, etc.)
    const results = [
      ...incidents.map(source => {
        const i = visibleIncidentSource(source, canReadSensitive);
        const urgencyLabel =
          i.urgency === 'HIGH' ? 'High' : i.urgency === 'MEDIUM' ? 'Medium' : 'Low';
        const urgencyPriority = i.urgency === 'HIGH' ? 1 : i.urgency === 'MEDIUM' ? 2 : 3;
        return {
          type: 'incident' as const,
          id: i.id,
          title: i.title,
          subtitle: `${i.service?.name || 'No service'} - ${i.status} - ${urgencyLabel}`,
          href: `/incidents/${i.id}`,
          priority: urgencyPriority,
        };
      }),
      ...services.map(s => ({
        type: 'service' as const,
        id: s.id,
        title: s.name,
        subtitle: `${s.team?.name || 'No team'} - ${s.status || 'Active'}`,
        href: `/services/${s.id}`,
        priority: 4,
      })),
      ...businessServices.map(b => {
        const status = businessHealth?.get(b.id)?.status;
        return {
          type: 'businessService' as const,
          id: b.id,
          title: b.name,
          subtitle: [
            'Business service',
            b.criticality ? b.criticality.replace('TIER_', 'Tier ') : null,
            status ? BUSINESS_STATUS_LABEL.get(status) : null,
          ]
            .filter(Boolean)
            .join(' - '),
          href: `/services/business/${b.id}`,
          priority: 4,
          ...(status ? { status } : {}),
        };
      }),
      ...teams.map(t => ({
        type: 'team' as const,
        id: t.id,
        title: t.name,
        subtitle: t.description || 'Team',
        href: `/teams/${t.id}`,
        priority: 5,
      })),
      ...users.map(u => ({
        type: 'user' as const,
        id: u.id,
        title: u.name || u.email,
        subtitle: u.email || `${u.role || 'User'}`,
        href: `/users?highlight=${u.id}`,
        priority: 6,
        avatarUrl: u.avatarUrl,
      })),
      ...policies.map(p => ({
        type: 'policy' as const,
        id: p.id,
        title: p.name,
        subtitle: p.description || 'Escalation Policy',
        href: `/policies/${p.id}`,
        priority: 7,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostmortemSearchResult does not model the selected incident automation fields; typing pm also surfaces pre-existing nullable titles in the merged sort, a separate fix
      ...postmortems.map((pm: any) => ({
        type: 'postmortem' as const,
        id: pm.id,
        title: pm.title,
        subtitle: `Postmortem for ${visibleIncidentSource(pm.incident, canReadSensitive).title} - ${pm.status}`,
        href: `/postmortems/${pm.incidentId}`,
        priority: 8,
      })),
      ...schedules.map(s => ({
        type: 'schedule' as const,
        id: s.id,
        title: s.name,
        subtitle: `On-call schedule - ${s.timeZone}`,
        href: `/schedules/${s.id}`,
        priority: 9,
      })),
      ...runbooks.map(r => ({
        type: 'runbook' as const,
        id: r.id,
        title: r.name,
        subtitle: r.description || 'Runbook',
        href: `/runbooks/${r.id}`,
        priority: 10,
      })),
    ]
      .sort((a, b) => {
        // Sort by priority first
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Then by relevance (exact matches first)
        const aExact = a.title.toLowerCase() === searchTermLower;
        const bExact = b.title.toLowerCase() === searchTermLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      })
      // priority is an internal type sort key, not incident priority; never expose it.
      .map(({ priority: _priority, ...result }) => result);

    // Add cache headers for search results (short cache, private)
    return jsonOk({ results }, 200, {
      'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
    });
  } catch (caught: unknown) {
    const error = caught as { message?: string; stack?: string } | null | undefined;
    logger.error('api.search.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Provide more detailed error information in development
    const errorMessage =
      process.env.NODE_ENV === 'development'
        ? error?.message || 'Search failed'
        : 'Search failed. Please try again.';
    return jsonError(errorMessage, 500, {
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
  }
}
