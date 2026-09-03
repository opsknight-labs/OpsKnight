import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { getCachedDashboardMetrics, getCachedRecentIncidents } from '@/lib/realtime-cache';
import {
  hasSameStreamAuthorizationScope,
  resolveStreamAuthorization,
  type StreamAuthorization,
} from '@/lib/realtime-stream-authorization';
import { recordSessionHeartbeat } from '@/lib/active-sessions';

/**
 * Server-Sent Events (SSE) endpoint for real-time updates
 * Streams incident updates, dashboard metrics, and service status changes
 */
export async function GET(req: NextRequest) {
  try {
    // Get current user for authorization
    const user = await getCurrentUser();
    const expectedTokenVersion = user.tokenVersion ?? 0;
    const initialAuthorization = await resolveStreamAuthorization(user.id, expectedTokenVersion);
    if (!initialAuthorization) {
      return new Response('Unauthorized', { status: 401 });
    }
    let streamAuthorization: StreamAuthorization = initialAuthorization;

    // Record session heartbeat on realtime stream connect
    const userAgent = req.headers.get('user-agent') || '';
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';
    void recordSessionHeartbeat({ userId: user.id, userAgent, ip }).catch(() => {});

    let cleanup: () => void = () => {};

    // Create a readable stream for SSE with change detection
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;

        let pollInterval: NodeJS.Timeout | null = null;
        let isPolling = false;

        cleanup = () => {
          isClosed = true;
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          try {
            controller.close();
          } catch (_error) {
            // Controller already closed, ignore
          }
        };

        // Track last sent metrics for change detection to reduce bandwidth
        let lastMetricsHash = '';
        let heartbeatCounter = 0;
        let authorizationCounter = 0;

        // Send initial connection message
        const send = (data: string) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            } catch (error) {
              logger.error('Error sending SSE data', { component: 'api-realtime-stream', error });
              cleanup();
            }
          }
        };

        // Send initial connection confirmation
        send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

        // Set up polling interval (every 5 seconds)
        // Uses caching layer to reduce database load by ~10x
        pollInterval = setInterval(async () => {
          if (isClosed || isPolling) return;
          isPolling = true;
          try {
            authorizationCounter++;
            if (authorizationCounter >= 12) {
              authorizationCounter = 0;
              const nextAuthorization = await resolveStreamAuthorization(
                user.id,
                expectedTokenVersion
              );
              if (
                !nextAuthorization ||
                !hasSameStreamAuthorizationScope(streamAuthorization, nextAuthorization)
              ) {
                send(JSON.stringify({ type: 'authorization_revoked' }));
                cleanup();
                return;
              }
              streamAuthorization = nextAuthorization;
            }
            // Get recent incident updates using cached query
            const incidentResult = await getCachedRecentIncidents(
              user.id,
              streamAuthorization.role,
              [...streamAuthorization.teamIds],
              lastMetricsHash ? undefined : undefined // Always check for incidents
            );

            // Only send incident updates if there are actual changes
            if (incidentResult && incidentResult.data.length > 0) {
              send(
                JSON.stringify({
                  type: 'incidents_updated',
                  incidents: incidentResult.data,
                  timestamp: new Date().toISOString(),
                })
              );
            }

            // Get dashboard metrics using cached query (reduces DB load by 80%)
            const metricsResult = await getCachedDashboardMetrics(
              user.id,
              streamAuthorization.role,
              [...streamAuthorization.teamIds],
              lastMetricsHash
            );

            // Only send metrics if they've changed (cache handles change detection)
            if (metricsResult && metricsResult.changed) {
              lastMetricsHash = metricsResult.hash;
              send(
                JSON.stringify({
                  type: 'metrics_updated',
                  metrics: {
                    open: metricsResult.data.open,
                    acknowledged: metricsResult.data.acknowledged,
                    resolved24h: metricsResult.data.resolved,
                    highUrgency: metricsResult.data.critical,
                    active: metricsResult.data.active,
                    isClipped: metricsResult.data.isClipped,
                    retentionDays: metricsResult.data.retentionDays,
                  },
                  timestamp: new Date().toISOString(),
                })
              );
            }

            // Send heartbeat every 6th poll (30 seconds) instead of every poll
            heartbeatCounter++;
            if (heartbeatCounter >= 6) {
              heartbeatCounter = 0;
              send(JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }));
              void recordSessionHeartbeat({ userId: user.id, userAgent, ip }).catch(() => {});
            }
          } catch (error) {
            logger.error('SSE polling error', { component: 'api-realtime-stream', error });
            send(
              JSON.stringify({
                type: 'error',
                message: 'Failed to fetch updates',
                timestamp: new Date().toISOString(),
              })
            );
          } finally {
            isPolling = false;
          }
        }, 5000); // Poll every 5 seconds

        // Clean up on client disconnect
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
  } catch (error) {
    logger.error('SSE stream error', { component: 'api-realtime-stream', error });
    return new Response('Internal Server Error', { status: 500 });
  }
}
