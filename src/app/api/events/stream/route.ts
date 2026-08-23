import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
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
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      role: true,
      teamMemberships: { select: { teamId: true } },
    },
  });

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const incidentId = searchParams.get('incidentId');
  const serviceId = searchParams.get('serviceId');

  const isPrivileged = user.role === 'ADMIN' || user.role === 'RESPONDER';
  const hasTeamAccess = (teamId?: string | null) => {
    if (!teamId) return true;
    if (isPrivileged) return true;
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

  let cleanup: () => void = () => {};

  // Create a ReadableStream for SSE with change detection
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Track last sent data hash for change detection
      let isClosed = false;
      let interval: NodeJS.Timeout | null = null;
      let isChecking = false;

      cleanup = () => {
        isClosed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        try {
          controller.close();
        } catch (_error) {
          // Already closed
        }
      };

      let lastDataHash = '';

      // Simple hash function for change detection
      const hashData = (data: any): string => {
        return JSON.stringify(data);
      };

      // Send initial connection message
      const send = (data: any) => {
        if (!isClosed) {
          try {
            const message = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (error) {
            cleanup();
          }
        }
      };

      // Send only if data has changed (for non-critical updates)
      const sendIfChanged = (data: any): boolean => {
        const currentHash = hashData(data);
        if (currentHash !== lastDataHash) {
          lastDataHash = currentHash;
          send(data);
          return true;
        }
        return false;
      };

      // Send connection confirmation
      send({ type: 'connected', timestamp: new Date().toISOString() });

      // Set up interval to check for updates
      // Uses caching layer to reduce database load by ~10x
      interval = setInterval(async () => {
        if (isClosed || isChecking) return;
        isChecking = true;
        try {
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
      req.signal.addEventListener('abort', () => {
        cleanup();
      });
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
