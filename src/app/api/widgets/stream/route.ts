import { logger } from '@/lib/logger';
import { getCachedWidgetData } from '@/lib/widget-data-cache';
import { buildRetainedDateFilter } from '@/lib/dashboard-utils';
import { dashboardMetricsScope } from '@/lib/authorization-filters';
import { getCurrentUser } from '@/lib/rbac';
import {
  hasSameStreamAuthorizationScope,
  resolveStreamAuthorization,
  type StreamAuthorization,
} from '@/lib/realtime-stream-authorization';

/**
 * Server-Sent Events (SSE) Stream for Real-time Widget Updates.
 * Revalidates role/status/tokenVersion/team scope for long-lived connections.
 */
export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    const expectedTokenVersion = currentUser.tokenVersion ?? 0;
    const initialAuthorization = await resolveStreamAuthorization(
      currentUser.id,
      expectedTokenVersion
    );
    if (!initialAuthorization) return new Response('Unauthorized', { status: 401 });
    let actor: StreamAuthorization = initialAuthorization;

    const encoder = new TextEncoder();
    const searchParams = new URL(request.url).searchParams;
    const range = searchParams.get('range') || '30';
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const assigneeParam = searchParams.get('assignee');
    const serviceParam = searchParams.get('service');

    const dateFilter = await buildRetainedDateFilter(range, startDate, endDate);
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

    let cleanup: () => void = () => {};

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        let intervalId: NodeJS.Timeout | null = null;
        let isUpdating = false;
        let authorizationCounter = 0;

        cleanup = () => {
          isClosed = true;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
          try {
            controller.close();
          } catch (_error) {
            // Already closed.
          }
          logger.info('sse.widgets.stream_closed', { userId: actor.id });
        };

        try {
          const initialData = await getCachedWidgetData(actor.id, actor.role, widgetFilters);
          if (!isClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));
          }
        } catch (error) {
          logger.error('sse.widgets.initial_error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        intervalId = setInterval(async () => {
          if (isClosed || isUpdating) return;
          isUpdating = true;
          try {
            authorizationCounter++;
            if (authorizationCounter >= 6) {
              authorizationCounter = 0;
              const nextAuthorization = await resolveStreamAuthorization(
                actor.id,
                expectedTokenVersion
              );
              if (!nextAuthorization || !hasSameStreamAuthorizationScope(actor, nextAuthorization)) {
                if (!isClosed) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'authorization_revoked' })}\n\n`)
                  );
                }
                cleanup();
                return;
              }
              actor = nextAuthorization;
              widgetFilters = buildWidgetFilters();
            }

            const data = await getCachedWidgetData(actor.id, actor.role, widgetFilters);
            if (!isClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            }
          } catch (error) {
            logger.error('sse.widgets.update_error', {
              error: error instanceof Error ? error.message : String(error),
            });
            cleanup();
          } finally {
            isUpdating = false;
          }
        }, 10000);

        request.signal.addEventListener('abort', () => {
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
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return new Response('Unauthorized', { status: 401 });
    logger.error('api.widgets.stream.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response('Internal Server Error', { status: 500 });
  }
}
