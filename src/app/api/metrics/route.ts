import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';

export async function GET(req: Request) {
  // Allow Prometheus scraping via Bearer token OR admin session
  const authHeader = req.headers.get('authorization');
  const prometheusToken = process.env.PROMETHEUS_SCRAPE_TOKEN;

  if (prometheusToken && authHeader === `Bearer ${prometheusToken}`) {
    // Prometheus scraper — allow through
  } else {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // Collect metrics
  const [jobStats, incidentCount, activeUsers] = await Promise.allSettled([
    prisma.backgroundJob.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.incident.count({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
  ]);

  const lines: string[] = [
    '# HELP opsknight_build_info Build information',
    '# TYPE opsknight_build_info gauge',
    `opsknight_build_info{version="${process.env.npm_package_version ?? 'unknown'}"} 1`,
    '',
    '# HELP opsknight_active_incidents Number of open or acknowledged incidents',
    '# TYPE opsknight_active_incidents gauge',
    `opsknight_active_incidents ${incidentCount.status === 'fulfilled' ? incidentCount.value : -1}`,
    '',
    '# HELP opsknight_active_users Number of active users',
    '# TYPE opsknight_active_users gauge',
    `opsknight_active_users ${activeUsers.status === 'fulfilled' ? activeUsers.value : -1}`,
    '',
    '# HELP opsknight_job_queue_total Job queue counts by status',
    '# TYPE opsknight_job_queue_total gauge',
  ];

  if (jobStats.status === 'fulfilled') {
    for (const row of jobStats.value) {
      lines.push(
        `opsknight_job_queue_total{status="${row.status.toLowerCase()}"} ${row._count.id}`
      );
    }
  }

  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}
