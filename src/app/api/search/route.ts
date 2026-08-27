import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import type { IncidentStatus, IncidentUrgency } from '@prisma/client';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';

const INSENSITIVE_MODE = 'insensitive' as const;

type IncidentWithService = {
  id: string;
  title: string;
  status: IncidentStatus;
  urgency: IncidentUrgency;
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
];

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
    if (!currentUser || currentUser.status === 'DISABLED') {
      return jsonError('Unauthorized', 401);
    }

    const isPrivileged = hasCapability(currentUser.role, CAPABILITIES.INCIDENT_READ_ALL);
    const teamIds = currentUser.teamMemberships.map(membership => membership.teamId);
    const incidentAccess = isPrivileged
      ? {}
      : {
          OR: [
            { assigneeId: currentUser.id },
            { watchers: { some: { userId: currentUser.id } } },
            {
              AND: [{ visibility: 'PUBLIC' as const }, { service: { teamId: { in: teamIds } } }],
            },
          ],
        };

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
                { title: { equals: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { title: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { description: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                ...(searchWords.length > 1
                  ? searchWords.slice(0, 3).map(word => ({
                      OR: [
                        { title: { contains: word, mode: INSENSITIVE_MODE } },
                        { description: { contains: word, mode: INSENSITIVE_MODE } },
                      ],
                    }))
                  : []),
                { id: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
          ],
        },
        take: 8, // Reduced for faster response on small systems
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          status: true,
          urgency: true,
          service: { select: { id: true, name: true } },
        },
      }),

      // Search services
      prisma.service.findMany({
        where: {
          AND: [
            isPrivileged ? {} : { teamId: { in: teamIds } },
            {
              OR: [
                { name: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { description: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
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
            {
              OR: [
                { name: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { description: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
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

      // Search users
      prisma.user.findMany({
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
            {
              OR: [
                { name: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { email: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
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
      }),

      // Search escalation policies
      prisma.escalationPolicy.findMany({
        where: {
          AND: [
            isPrivileged ? {} : { services: { some: { teamId: { in: teamIds } } } },
            {
              OR: [
                { name: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                { description: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
              ],
            },
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
                isPrivileged
                  ? {}
                  : {
                      incident: incidentAccess,
                    },
                {
                  OR: [
                    { title: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                    { summary: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                    { rootCause: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                    { lessons: { contains: sanitizedTerm, mode: INSENSITIVE_MODE } },
                  ],
                },
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
                },
              },
            },
          });
        } catch (_e) {
          // If postmortem model doesn't exist or query fails, return empty
          return [];
        }
      })(),
    ];

    const [incidents, services, teams, users, policies, postmortemsResult] = (await Promise.all(
      searchPromises
    )) as SearchResponses;

    // Handle postmortems result (unwrap promise if needed)
    const postmortems = Array.isArray(postmortemsResult) ? postmortemsResult : [];

    // Format results with proper priorities (incidents first, then services, etc.)
    const results = [
      ...incidents.map(i => {
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
      ...postmortems.map((pm: any) => ({
        type: 'postmortem' as const,
        id: pm.id,
        title: pm.title,
        subtitle: `Postmortem for ${pm.incident.title} - ${pm.status}`,
        href: `/postmortems/${pm.incidentId}`,
        priority: 8,
      })),
    ].sort((a, b) => {
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
    });

    // Add cache headers for search results (short cache, private)
    return jsonOk({ results }, 200, {
      'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
    });
  } catch (error: any) {
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
