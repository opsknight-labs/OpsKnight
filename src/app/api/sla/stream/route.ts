import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertCanReadServiceMetrics } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { default: prisma } = await import('@/lib/prisma');

  const searchParams = req.nextUrl.searchParams;
  const serviceId = searchParams.get('serviceId');
  const windowDays = parseInt(searchParams.get('windowDays') || '7', 10);

  let user;
  try {
    user = await assertCanReadServiceMetrics({ serviceId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Forbidden' },
      { status: 403 }
    );
  }

  const rateLimitKey = `sla-stream:${user.id}`;
  const rateLimit = await checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': RATE_LIMIT_MAX.toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString(),
          'Retry-After': retryAfter.toString(),
        },
      }
    );
  }

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - windowDays);

  const where = {
    createdAt: { gte: startDate, lte: now },
    ...(serviceId ? { serviceId } : {}),
  };

  const encoder = new TextEncoder();
  let isCancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const totalCount = await prisma.incident.count({ where });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'meta', totalCount, batchSize: BATCH_SIZE })}\n\n`
          )
        );

        let skip = 0;
        let batchNumber = 0;

        while (true) {
          if (req.signal.aborted || isCancelled) {
            break;
          }

          const batch = await prisma.incident.findMany({
            where,
            select: {
              id: true,
              title: true,
              status: true,
              urgency: true,
              createdAt: true,
              acknowledgedAt: true,
              resolvedAt: true,
              serviceId: true,
              service: {
                select: {
                  name: true,
                  targetAckMinutes: true,
                  targetResolveMinutes: true,
                },
              },
            },
            take: BATCH_SIZE,
            skip,
            orderBy: { createdAt: 'desc' },
          });

          if (batch.length === 0 || req.signal.aborted || isCancelled) break;

          const data = JSON.stringify({
            type: 'batch',
            batchNumber,
            incidents: batch,
            remaining: Math.max(0, totalCount - skip - batch.length),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));

          skip += BATCH_SIZE;
          batchNumber++;
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (!req.signal.aborted && !isCancelled) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'complete', totalBatches: batchNumber })}\n\n`
            )
          );
        }
        controller.close();
      } catch (_error) {
        if (!req.signal.aborted && !isCancelled) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'Failed to stream SLA data' })}\n\n`
            )
          );
        }
        controller.close();
      }
    },
    cancel() {
      isCancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
