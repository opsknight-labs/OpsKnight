import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCachedWidgetData } from '@/lib/widget-data-cache';
import prisma from '@/lib/prisma';
import { buildRetainedDateFilter } from '@/lib/dashboard-utils';
import { dashboardMetricsScope } from '@/lib/authorization-filters';
import {
  hasSameStreamAuthorizationScope,
  resolveStreamAuthorization,
  type StreamAuthorization,
} from '@/lib/realtime-stream-authorization';
import {
  getRealtimeChangeGeneration,
  subscribeToRealtimeChanges,
} from '@/lib/realtime-change-control-plane';

/** Event-driven SSE stream for filtered dashboard widget projections. */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) return new Response('Unauthorized', { status: 401 });

    const sessionUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!sessionUser) return new Response('Unauthorized', { status: 401 });

    const expectedTokenVersion = session.user.tokenVersion ?? 0;
    const initialAuthorization = await resolveStreamAuthorization(
      sessionUser.id,
      expectedTokenVersion
    );
    if (!initialAuthorization) return new Response('Unauthorized', { status: 401 });
    let actor: StreamAuthorization = initialAuthorization;

    const searchParams = new URL(request.url).searchParams;
    const range = searchParams.get('range') || '30';
    const dateFilter = await buildRetainedDateFilter(
      range,
      searchParams.get('startDate') || undefined,
      searchParams.get('endDate') || undefined
    );
    const assigneeParam = searchParams.get('assignee');
    const serviceParam = searchParams.get('service');
    const baseWidgetFilters = {
      serviceId: serviceParam && serviceParam !== 'all' ? serviceParam : undefined,
      assigneeId: assigneeParam === null ? undefined : assigneeParam === '' ? null : assigneeParam,
      urgency: (searchParams.get('urgency') as 'HIGH' | 'MEDIUM' | 'LOW' | null) || undefined,
      status:
        (searchParams.get('status') as
          | 'OPEN'
          | 'ACKNOWLEDGED'
          | 'SNOOZED'
          | 'SUPPRESSED'
          | 'RESOLVED'
          | null) || undefined,
      startDate: dateFilter.window.start,
      endDate: dateFilter.window.end,
      includeAllTime: range === 'all',
    };
    const buildWidgetFilters = () => ({
      ...baseWidgetFilters,
      ...dashboardMetricsScope(actor),
    });
    let widgetFilters = buildWidgetFilters();
    const encoder = new TextEncoder();
    let cleanup: () => void = () => {};

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        let isUpdating = false;
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        let unsubscribeChanges: () => void = () => {};
        let authorizationCounter = 0;
        let pendingGeneration: string | null | undefined;

        const send = (value: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          } catch (error) {
            logger.debug('sse.widgets.send_closed', {
              error: error instanceof Error ? error.message : String(error),
            });
            cleanup();
          }
        };
        cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          unsubscribeChanges();
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          try {
            controller.close();
          } catch {
            // The browser or proxy already closed the controller.
          }
          logger.info('sse.widgets.stream_closed', { userId: actor.id });
        };

        const refreshProjection = async (generation: string | null) => {
          if (isClosed) return;
          if (isUpdating) {
            pendingGeneration = generation;
            return;
          }
          isUpdating = true;
          try {
            const data = await getCachedWidgetData(
              actor.id,
              actor.role,
              widgetFilters,
              Date.now(),
              generation
            );
            send(data);
          } catch (error) {
            logger.error('sse.widgets.update_error', {
              error: error instanceof Error ? error.message : String(error),
            });
            send({ type: 'error', message: 'Widget updates are temporarily unavailable' });
          } finally {
            isUpdating = false;
            const pending = pendingGeneration;
            pendingGeneration = undefined;
            if (pending !== undefined && !isClosed) void refreshProjection(pending);
          }
        };

        request.signal.addEventListener('abort', cleanup, { once: true });
        if (request.signal.aborted) {
          cleanup();
          return;
        }

        const initialGeneration = await getRealtimeChangeGeneration();
        await refreshProjection(initialGeneration);
        if (isClosed) return;
        unsubscribeChanges = subscribeToRealtimeChanges(
          'widgets',
          initialGeneration,
          refreshProjection
        );

        heartbeatInterval = setInterval(async () => {
          if (isClosed) return;
          send({ type: 'heartbeat', timestamp: new Date().toISOString() });
          authorizationCounter += 1;
          if (authorizationCounter < 2) return;
          authorizationCounter = 0;
          try {
            const nextAuthorization = await resolveStreamAuthorization(
              actor.id,
              expectedTokenVersion
            );
            if (!nextAuthorization || !hasSameStreamAuthorizationScope(actor, nextAuthorization)) {
              send({ type: 'authorization_revoked' });
              cleanup();
              return;
            }
            actor = nextAuthorization;
            widgetFilters = buildWidgetFilters();
          } catch (error) {
            logger.warn('widgets.authorization_recheck_failed', {
              userId: actor.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }, 30_000);
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    logger.error('api.widgets.stream.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response('Internal Server Error', { status: 500 });
  }
}
