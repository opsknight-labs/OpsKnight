import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  getCachedDashboardMetrics,
  getCachedServiceIncidents,
  getCachedIncidentDetails,
} from '@/lib/realtime-cache';

/**
 * Server-Sent Events (SSE) endpoint for real-time incident updates
 *
 * GET /api/events/stream?incidentId=xxx
 *
 * Streams real-time updates for:
 * - Incident status changes
 * - New incident events
 * - New notes
 * - Assignment changes
 * - Escalation updates
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(await getAuthOptions());

  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const prisma = (await import('@/lib/prisma')).default;
  const sessionTokenVersion = session.user.tokenVersion ?? 0;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      role: true,
      tokenVersion: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  if (!user || (user.tokenVersion ?? 0) !== sessionTokenVersion) {
    return new Response('Unauthorized', { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const incidentId = searchParams.get('incidentId');
  const serviceId = searchParams.get('serviceId');

  const isPrivileged = hasCapability(user.role, CAPABILITIES.INCIDENT_READ_ALL);
  const hasTeamAccess = (teamId?: string | null) => {
    if (isPrivileged) return true;
    if (!teamId) return false;
    return user.teamMemberships.some(membership => membership.teamId === teamId);
  };

  if (incidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { id: true, service: { select: { teamId: true } } },
    });

    if (!incident) {
      return new Response('Not Found', { status: 404 });
    }

    if (!hasTeamAccess(incident.service?.teamId || null)) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, teamId: true },
    });

    if (!service) {
      return new Response('Not Found', { status: 404 });
    }

    if (!hasTeamAccess(service.teamId)) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  // Create a ReadableStream for SSE with change detection
  const stream = new ReadableStream({
    async start(controller) {
      if (req.signal.aborted) {
        return;
      }

      let lastDataHash: string | undefined;
      let isChecking = false;
      let tickCount = 0;

      const send = (data: Record<string, unknown>) => {
        if (isClosed) return;
        try {
          const payload = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch (_e) {
          cleanup();
        }
      };

      // Send initial connection message
      send({ type: 'connected', timestamp: new Date().toISOString() });

      // Set up interval to check for updates
      // Uses caching layer to reduce database load by ~10x
      interval = setInterval(async () => {
        if (isClosed || isChecking) return;
        isChecking = true;
        tickCount++;
        try {
          if (tickCount % 12 === 0) {
            const currentUser = await prisma.user.findUnique({
              where: { id: user.id },
              select: {
                status: true,
                role: true,
                tokenVersion: true,
                teamMemberships: { select: { teamId: true } },
              },
            });
            const currentTeamIds = new Set(
              currentUser?.teamMemberships.map(membership => membership.teamId) || []
            );
            let stillAuthorized =
              currentUser?.status === 'ACTIVE' &&
              (currentUser.tokenVersion ?? 0) === sessionTokenVersion;
            const currentlyPrivileged = currentUser
              ? hasCapability(currentUser.role, CAPABILITIES.INCIDENT_READ_ALL)
              : false;
            if (stillAuthorized && !currentlyPrivileged && incidentId) {
              const target = await prisma.incident.findUnique({
                where: { id: incidentId },
                select: { service: { select: { teamId: true } } },
              });
              stillAuthorized = Boolean(
                target?.service.teamId && currentTeamIds.has(target.service.teamId)
              );
            }
            if (stillAuthorized && !currentlyPrivileged && serviceId) {
              const target = await prisma.service.findUnique({
                where: { id: serviceId },
                select: { teamId: true },
              });
              stillAuthorized = Boolean(target?.teamId && currentTeamIds.has(target.teamId));
            }
            if (!stillAuthorized) {
              send({ type: 'authorization_revoked' });
              cleanup();
              try {
                controller.close();
              } catch {}
              return;
            }
          }
          let sentUpdate = false;
          if (incidentId) {
            // Stream updates for a specific incident using cache
            const result = await getCachedIncidentDetails(incidentId, lastDataHash);

            if (result && result.changed && result.data) {
              const incident = result.data;
              const updateData = {
                type: 'incident_update',
                incident: {
                  id: incident.id,
                  status: incident.status,
                  urgency: incident.urgency,
                  assigneeId: incident.assigneeId,
                  nextEscalationAt: incident.nextEscalationAt,
                  escalationStatus: incident.escalationStatus,
                },
                latestEvent: incident.events[0],
                latestNote: incident.notes[0],
              };
              lastDataHash = result.hash;
              send(updateData);
              sentUpdate = true;
            }
          } else if (serviceId) {
            // Stream updates for incidents in a service using cache
            const result = await getCachedServiceIncidents(serviceId, lastDataHash);

            if (result && result.changed) {
              const updateData = {
                type: 'service_incidents_update',
                serviceId,
                incidents: result.data,
              };
              lastDataHash = result.hash;
              send(updateData);
              sentUpdate = true;
            }
          } else {
            // Stream dashboard updates using cached metrics
            const teamIds = user.teamMemberships.map(m => m.teamId);
            const result = await getCachedDashboardMetrics(
              user.id,
              user.role,
              teamIds,
              lastDataHash
            );

            if (result && result.changed) {
              const updateData = {
                type: 'dashboard_stats',
                stats: {
                  open: result.data.open,
                  acknowledged: result.data.acknowledged,
                  resolved: result.data.resolved,
                  critical: result.data.critical,
                  isClipped: result.data.isClipped,
                  retentionDays: result.data.retentionDays,
                },
              };
              lastDataHash = result.hash;
              send(updateData);
              sentUpdate = true;
            }
          }

          // Emit keepalive every 15s if no update was sent
          if (!sentUpdate && tickCount % 3 === 0 && !isClosed) {
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch {
              cleanup();
            }
          }
        } catch (_error) {
          if (!isClosed) {
            send({ type: 'error', message: 'Failed to fetch updates' });
          }
        } finally {
          isChecking = false;
        }
      }, 5000); // Check every 5 seconds

      // Cleanup on client disconnect
      const onAbort = () => {
        cleanup();
        try {
          controller.close();
        } catch (_e) {}
        req.signal.removeEventListener('abort', onAbort);
      };
      req.signal.addEventListener('abort', onAbort);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
