import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { tokensMatch } from '@/app/api/metrics/route';
import { getJobWorkerStatus } from '@/lib/job-worker';
import { getCronSchedulerStatus } from '@/lib/cron-scheduler';
import { jsonApiOk } from '@/lib/api-response';

async function authorized(request: Request): Promise<boolean> {
  const token = process.env.PROMETHEUS_SCRAPE_TOKEN;
  if (token && tokensMatch(request.headers.get('authorization'), token)) return true;
  const session = await getServerSession(await getAuthOptions());
  return session?.user?.role === 'ADMIN';
}

export async function GET(request: Request) {
  if (!(await authorized(request))) return new NextResponse('Unauthorized', { status: 401 });

  const now = Date.now();
  const [queue, notifications, rollup] = await Promise.allSettled([
    prisma.backgroundJob.aggregate({
      where: { status: 'PENDING' },
      _count: { id: true },
      _min: { scheduledAt: true },
    }),
    prisma.notification.aggregate({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      _count: { id: true },
      _min: { createdAt: true },
    }),
    prisma.incidentMetricRollup.findFirst({
      where: { granularity: 'daily' },
      orderBy: { date: 'desc' },
      select: { date: true, updatedAt: true },
    }),
  ]);

  const ageSeconds = (date: Date | null | undefined) =>
    date ? Math.max(0, (now - date.getTime()) / 1000) : null;
  return jsonApiOk(
    {
      status: [queue, notifications, rollup].every(result => result.status === 'fulfilled')
        ? 'healthy'
        : 'degraded',
      timestamp: new Date(now).toISOString(),
      worker: getJobWorkerStatus(),
      scheduler: await getCronSchedulerStatus(),
      jobs:
        queue.status === 'fulfilled'
          ? {
              pending: queue.value._count.id,
              oldestPendingAgeSeconds: ageSeconds(queue.value._min.scheduledAt),
            }
          : { status: 'unavailable' },
      notifications:
        notifications.status === 'fulfilled'
          ? {
              pending: notifications.value._count.id,
              oldestPendingAgeSeconds: ageSeconds(notifications.value._min.createdAt),
            }
          : { status: 'unavailable' },
      rollups:
        rollup.status === 'fulfilled'
          ? {
              lastCompleteDay: rollup.value?.date ?? null,
              ageSeconds: ageSeconds(rollup.value?.updatedAt),
            }
          : { status: 'unavailable' },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
