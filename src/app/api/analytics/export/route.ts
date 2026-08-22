import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertResponderOrAbove } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  IncidentStatus as IncidentStatusEnum,
  IncidentUrgency as IncidentUrgencyEnum,
} from '@prisma/client';
import type { IncidentStatus, IncidentUrgency } from '@prisma/client';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { getQueryDateBounds } from '@/lib/retention-policy';
import { calculateSLAMetrics } from '@/lib/sla-server';

const incidentStatusValues = new Set<string>(Object.values(IncidentStatusEnum));
const incidentUrgencyValues = new Set<string>(Object.values(IncidentUrgencyEnum));

const normalizeIncidentStatusParam = (value: string | null): IncidentStatus | 'ALL' => {
  if (!value || value === 'ALL') return 'ALL';
  return incidentStatusValues.has(value) ? (value as IncidentStatus) : 'ALL';
};

const normalizeIncidentUrgencyParam = (value: string | null): IncidentUrgency | 'ALL' => {
  if (!value || value === 'ALL') return 'ALL';
  return incidentUrgencyValues.has(value) ? (value as IncidentUrgency) : 'ALL';
};

const formatMinutes = (ms: number | null) =>
  ms === null ? '--' : `${(ms / 1000 / 60).toFixed(1)}m`;
const formatPercent = (value: number) => `${value.toFixed(0)}%`;

function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Mitigate CSV Formula Injection (CWE-1236)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCSV(data: any[][]): string {
  return data.map(row => row.map(escapeCSV).join(',')).join('\n');
}

function createProgressBar(value: number, max: number, length: number = 20): string {
  const percentage = max > 0 ? value / max : 0;
  const filled = Math.round(percentage * length);
  const empty = length - filled;
  // Use ASCII characters for better compatibility
  return '='.repeat(filled) + '-'.repeat(empty) + ` ${(percentage * 100).toFixed(1)}%`;
}

function formatDate(date: Date, timeZone: string): string {
  // Format as: Dec 21, 2025 09:31 PM in user's timezone
  return formatDateTime(date, timeZone, { format: 'datetime', hour12: true });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      return jsonError('Unauthorized', 401);
    }

    try {
      await assertResponderOrAbove();
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
    }

    // Get user timezone for date formatting
    const email = session?.user?.email ?? null;
    const user = email
      ? await prisma.user.findUnique({
          where: { email },
          select: { timeZone: true },
        })
      : null;
    const userTimeZone = getUserTimeZone(user ?? undefined);

    const searchParams = req.nextUrl.searchParams;

    const teamId =
      searchParams.get('team') && searchParams.get('team') !== 'ALL'
        ? searchParams.get('team')
        : null;
    const serviceId =
      searchParams.get('service') && searchParams.get('service') !== 'ALL'
        ? searchParams.get('service')
        : null;
    const assigneeId =
      searchParams.get('assignee') && searchParams.get('assignee') !== 'ALL'
        ? searchParams.get('assignee')
        : null;
    const statusFilter = normalizeIncidentStatusParam(searchParams.get('status'));
    const urgencyFilter = normalizeIncidentUrgencyParam(searchParams.get('urgency'));
    const windowDays = parseInt(searchParams.get('window') || '7', 10);

    const now = new Date();
    const requestedStart = new Date(now);
    requestedStart.setDate(now.getDate() - windowDays);
    const {
      start: effectiveStart,
      end: effectiveEnd,
      isClipped,
    } = await getQueryDateBounds(requestedStart, now, 'incident');

    // Build where clauses
    const serviceWhere = serviceId ? { serviceId } : teamId ? { service: { teamId } } : null;

    const statusWhere = statusFilter !== 'ALL' ? { status: statusFilter } : null;
    const urgencyWhere = urgencyFilter !== 'ALL' ? { urgency: urgencyFilter } : null;
    const assigneeWhere = assigneeId ? { assigneeId } : null;

    const recentIncidentWhere = {
      createdAt: { gte: effectiveStart, lte: effectiveEnd },
      ...(serviceWhere ?? {}),
      ...(urgencyWhere ?? {}),
      ...(statusWhere ?? {}),
      ...(assigneeWhere ?? {}),
    };

    // Fetch data with limits to prevent memory issues on large datasets
    const [metrics, recentIncidents, services, teams, users] = await Promise.all([
      calculateSLAMetrics({
        startDate: effectiveStart,
        endDate: effectiveEnd,
        teamId: teamId || undefined,
        serviceId: serviceId || undefined,
        assigneeId: assigneeId || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        urgency: urgencyFilter !== 'ALL' ? urgencyFilter : undefined,
        userTimeZone,
      }),
      prisma.incident.findMany({
        where: recentIncidentWhere,
        include: {
          service: true,
          assignee: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10000, // Limit to prevent OOM on large datasets
      }),
      prisma.service.findMany({
        where: teamId ? { teamId } : undefined,
        select: { id: true, name: true, teamId: true },
        take: 500, // Reasonable limit for services
      }),
      prisma.team.findMany({
        select: { id: true, name: true },
        take: 200, // Reasonable limit for teams
      }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true },
        take: 2000, // Reasonable limit for users
      }),
    ]);

    // Build lookup maps for O(1) access instead of O(n) array.find()
    const teamMap = new Map(teams.map(t => [t.id, t]));
    const serviceMap = new Map(services.map(s => [s.id, s]));
    const userMap = new Map(users.map(u => [u.id, u]));

    // Calculate metrics
    const totalIncidents = metrics.totalIncidents;
    const resolvedIncidents = recentIncidents.filter(i => i.status === 'RESOLVED');
    const openIncidents = recentIncidents.filter(i => i.status === 'OPEN');
    const highUrgencyCount = metrics.highUrgencyCount;

    const mttaMs = metrics.mttd === null ? null : metrics.mttd * 60 * 1000;
    const mttrMs = metrics.mttr === null ? null : metrics.mttr * 60 * 1000;

    const resolutionRate = metrics.resolveRate;
    const ackRate = metrics.ackRate;

    // Build CSV content with well-designed structure
    const csvRows: string[][] = [];

    // Header section with branding (using ASCII characters)
    csvRows.push(['===============================================================']);
    csvRows.push(['                    ANALYTICS REPORT']);
    csvRows.push(['              Operational Readiness Dashboard']);
    csvRows.push(['===============================================================']);
    csvRows.push(['']);
    csvRows.push(['Report Generated:', formatDate(now, userTimeZone)]);
    csvRows.push(['Time Window:', `Last ${windowDays} day${windowDays !== 1 ? 's' : ''}`]);
    csvRows.push([
      'Report Period:',
      `${formatDate(effectiveStart, userTimeZone)} to ${formatDate(effectiveEnd, userTimeZone)}`,
    ]);
    if (isClipped) {
      csvRows.push([
        'Retention Note:',
        `Data clipped to retention window (${formatDate(effectiveStart, userTimeZone)} to ${formatDate(effectiveEnd, userTimeZone)})`,
      ]);
    }
    csvRows.push(['']);

    // Filter information
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['FILTERS APPLIED']);
    csvRows.push(['---------------------------------------------------------------']);
    const hasFilters =
      teamId || serviceId || assigneeId || statusFilter !== 'ALL' || urgencyFilter !== 'ALL';
    if (hasFilters) {
      if (teamId) {
        const team = teamMap.get(teamId);
        csvRows.push(['Team:', team?.name || teamId]);
      } else {
        csvRows.push(['Team:', 'All Teams']);
      }
      if (serviceId) {
        const service = serviceMap.get(serviceId);
        csvRows.push(['Service:', service?.name || serviceId]);
      } else {
        csvRows.push(['Service:', 'All Services']);
      }
      if (assigneeId) {
        const user = userMap.get(assigneeId);
        csvRows.push(['Assignee:', user?.name || user?.email || assigneeId]);
      } else {
        csvRows.push(['Assignee:', 'All Assignees']);
      }
      csvRows.push(['Status:', statusFilter === 'ALL' ? 'All Statuses' : statusFilter]);
      csvRows.push(['Urgency:', urgencyFilter === 'ALL' ? 'All Urgencies' : urgencyFilter]);
    } else {
      csvRows.push(['No filters applied - showing all data']);
    }
    csvRows.push(['']);

    // Summary metrics with visual separators
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['KEY PERFORMANCE INDICATORS (KPIs)']);
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['Metric', 'Value', 'Status']);

    // Add status indicators with ASCII-compatible characters
    const getStatusIndicator = (value: number, thresholds: { good: number; warning: number }) => {
      if (value >= thresholds.good) return '[OK] Good';
      if (value >= thresholds.warning) return '[!] Warning';
      return '[X] Needs Attention';
    };

    csvRows.push(['Total Incidents', totalIncidents.toString(), '']);
    csvRows.push([
      'Open Incidents',
      openIncidents.length.toString(),
      openIncidents.length > 10 ? '[!] High' : '[OK] Normal',
    ]);
    csvRows.push(['Resolved Incidents', resolvedIncidents.length.toString(), '']);
    csvRows.push([
      'High Urgency Incidents',
      highUrgencyCount.toString(),
      highUrgencyCount > 5 ? '[!] High' : '[OK] Normal',
    ]);

    // MTTA with visual indicator
    const mttaStatus =
      mttaMs != null && mttaMs < 15 * 60 * 1000
        ? '[OK] Good'
        : mttaMs != null && mttaMs < 30 * 60 * 1000
          ? '[!] Review'
          : '[X] Needs Attention';
    csvRows.push(['MTTA (Mean Time to Acknowledge)', formatMinutes(mttaMs), mttaStatus]);

    // MTTR with visual indicator
    const mttrStatus =
      mttrMs != null && mttrMs < 120 * 60 * 1000
        ? '[OK] Good'
        : mttrMs != null && mttrMs < 240 * 60 * 1000
          ? '[!] Review'
          : '[X] Needs Attention';
    csvRows.push(['MTTR (Mean Time to Resolve)', formatMinutes(mttrMs), mttrStatus]);

    csvRows.push([
      'Acknowledgment Rate',
      formatPercent(ackRate),
      getStatusIndicator(ackRate, { good: 90, warning: 70 }),
    ]);
    csvRows.push([
      'Resolution Rate',
      formatPercent(resolutionRate),
      getStatusIndicator(resolutionRate, { good: 80, warning: 60 }),
    ]);
    csvRows.push(['']);

    // Status breakdown with visual bars
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['INCIDENT STATUS BREAKDOWN']);
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['Status', 'Count', 'Percentage', 'Visual Bar']);
    const statusMap = new Map<IncidentStatus, number>(
      metrics.statusMix.map(entry => [entry.status as IncidentStatus, entry.count])
    );
    const statusOrder: IncidentStatus[] = [
      'OPEN',
      'ACKNOWLEDGED',
      'SNOOZED',
      'SUPPRESSED',
      'RESOLVED',
    ];
    const maxStatusCount = Math.max(...Array.from(statusMap.values()), 1);
    statusOrder.forEach(status => {
      const count = statusMap.get(status) || 0;
      const percentage = totalIncidents
        ? parseFloat(((count / totalIncidents) * 100).toFixed(1))
        : 0;
      const progressBar = createProgressBar(count, maxStatusCount, 30);
      csvRows.push([status, count.toString(), `${percentage.toFixed(1)}%`, progressBar]);
    });
    csvRows.push(['']);

    // Top services with ranking and visualization
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['TOP SERVICES BY INCIDENT COUNT']);
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['Rank', 'Service', 'Incident Count', 'Percentage', 'Visual Bar']);
    const maxServiceCount =
      metrics.topServices.length > 0
        ? Math.max(...metrics.topServices.map(entry => entry.count))
        : 1;
    metrics.topServices.forEach((entry, index) => {
      const serviceName = entry.name || 'Unknown Service';
      const percentage = totalIncidents ? ((entry.count / totalIncidents) * 100).toFixed(1) : '0.0';
      const progressBar = createProgressBar(entry.count, maxServiceCount, 25);
      csvRows.push([
        `#${index + 1}`,
        serviceName,
        entry.count.toString(),
        `${percentage}%`,
        progressBar,
      ]);
    });
    csvRows.push(['']);

    // Detailed incident list with better formatting
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push(['DETAILED INCIDENT LIST']);
    csvRows.push(['---------------------------------------------------------------']);
    csvRows.push([
      'ID',
      'Title',
      'Service',
      'Status',
      'Urgency',
      'Assignee',
      'Created At',
      'Updated At',
      'Duration (hours)',
    ]);

    recentIncidents.forEach(incident => {
      const endTime =
        incident.status === 'RESOLVED' && incident.resolvedAt
          ? incident.resolvedAt
          : incident.updatedAt;
      const duration =
        endTime && incident.createdAt
          ? ((endTime.getTime() - incident.createdAt.getTime()) / 1000 / 60 / 60).toFixed(2)
          : '--';

      csvRows.push([
        incident.id,
        incident.title || '',
        incident.service?.name || 'Unknown',
        incident.status,
        incident.urgency,
        incident.assignee?.name || incident.assignee?.email || 'Unassigned',
        formatDate(incident.createdAt, userTimeZone),
        formatDate(incident.updatedAt, userTimeZone),
        duration,
      ]);
    });

    // Generate CSV with UTF-8 BOM for Excel compatibility
    const csvContent = generateCSV(csvRows);
    // Add UTF-8 BOM for proper Excel encoding
    const csvWithBOM = '\uFEFF' + csvContent;

    // Return response with proper encoding
    return new NextResponse(csvWithBOM, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analytics-report-${new Date().toISOString().split('T')[0]}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('api.analytics.export_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to generate export', 500);
  }
}
