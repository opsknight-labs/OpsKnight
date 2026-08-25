import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { calculatePercentile } from '@/lib/analytics-metrics';

/**
 * SLA Performance Admin API
 *
 * Returns SLA query performance metrics for admin monitoring.
 *
 * GET /api/admin/sla-performance
 *
 * Rate Limit: 60 requests per minute per admin
 */

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

interface PerformanceMetrics {
  period: string;
  queryCount: number;
  avgDuration: number | null;
  p50Duration: number | null;
  p95Duration: number | null;
  slowQueryCount: number;
  avgIncidentCount: number | null;
  recommendations: string[];
}

export async function GET(req: NextRequest) {
  const { assertAdmin } = await import('@/lib/rbac');
  let user;
  try {
    user = await assertAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized' },
      { status: 403 }
    );
  }
  const { default: prisma } = await import('@/lib/prisma');

  // Rate limiting
  const rateLimitKey = `sla-performance:${user.email}`;
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

  // Parse query parameters
  const searchParams = req.nextUrl.searchParams;
  const period = searchParams.get('period') || '24h';

  // Calculate time range based on period
  const now = new Date();
  const startTime = new Date(now);

  switch (period) {
    case '1h':
      startTime.setHours(now.getHours() - 1);
      break;
    case '24h':
      startTime.setHours(now.getHours() - 24);
      break;
    case '7d':
      startTime.setDate(now.getDate() - 7);
      break;
    case '30d':
      startTime.setDate(now.getDate() - 30);
      break;
    default:
      startTime.setHours(now.getHours() - 24); // Default to 24h
  }

  // Query SLA performance logs
  const logs = await prisma.sLAPerformanceLog.findMany({
    where: {
      timestamp: { gte: startTime },
    },
    select: {
      durationMs: true,
      incidentCount: true,
    },
    orderBy: { durationMs: 'asc' },
  });

  const queryCount = logs.length;

  // Calculate metrics
  let avgDuration: number | null = null;
  let p50Duration: number | null = null;
  let p95Duration: number | null = null;
  let slowQueryCount = 0;
  let avgIncidentCount: number | null = null;

  if (queryCount > 0) {
    // Average duration
    const totalDuration = logs.reduce((sum: number, log: any) => sum + log.durationMs, 0);
    avgDuration = Math.round(totalDuration / queryCount);

    // Average incident count
    const totalIncidentCount = logs.reduce((sum: number, log: any) => sum + log.incidentCount, 0);
    avgIncidentCount = Math.round(totalIncidentCount / queryCount);

    // Percentiles (logs are already sorted by durationMs)
    const durations = logs.map((log: { durationMs: number }) => log.durationMs);
    p50Duration = calculatePercentile(durations, 50);
    p95Duration = calculatePercentile(durations, 95);

    // Slow queries (>5 seconds)
    slowQueryCount = logs.filter((log: any) => log.durationMs > 5000).length;
  }

  const metrics: PerformanceMetrics = {
    period,
    queryCount,
    avgDuration,
    p50Duration,
    p95Duration,
    slowQueryCount,
    avgIncidentCount,
    recommendations: getPerformanceRecommendations(avgDuration, p95Duration, avgIncidentCount),
  };

  return NextResponse.json({
    success: true,
    metrics,
    meta: {
      generatedAt: new Date().toISOString(),
      dataSource: 'sla_performance_log',
      timeRange: {
        start: startTime.toISOString(),
        end: now.toISOString(),
      },
    },
  });
}

function getPerformanceRecommendations(
  avgDuration: number | null,
  p95Duration: number | null,
  avgIncidentCount: number | null
): string[] {
  const recommendations: string[] = [];

  // Performance-based recommendations
  if (avgDuration !== null && avgDuration > 3000) {
    recommendations.push(
      'Average query time is high (>3s). Consider using rollup data for historical queries.'
    );
  }

  if (p95Duration !== null && p95Duration > 5000) {
    recommendations.push(
      '95th percentile query time is very high (>5s). Consider adding indexes or using data aggregation.'
    );
  }

  if (avgIncidentCount !== null && avgIncidentCount > 50000) {
    recommendations.push(
      'Large dataset detected. Use the /api/sla/stream endpoint for datasets >50k incidents.'
    );
  }

  // Always include baseline recommendations
  recommendations.push('Use service or team filters to reduce query scope');
  recommendations.push('Consider using rollup data for queries >90 days');
  recommendations.push('Ensure database indexes are applied via Prisma migration');

  return recommendations;
}
