import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

/**
 * Incident Context Enrichment
 * Attaches related telemetry data (Silver/Bronze) to incidents
 */

export interface IncidentContext {
  incidentId: string;

  // Silver Tier: Related Metrics
  relatedMetrics: {
    name: string;
    avgValue: number;
    count: number;
    minValue: number;
    maxValue: number;
  }[];

  // Bronze Tier: Related Logs
  relatedLogs: {
    id: string;
    level: string;
    message: string;
    timestamp: Date;
    context?: Prisma.JsonValue;
  }[];

  // Time Context
  timeWindow: {
    start: Date;
    end: Date;
  };
}

/**
 * Get enrichment context for an incident
 * Fetches related metrics and logs from the time window around incident creation
 */
export async function getIncidentContext(
  incidentId: string,
  windowMinutes: number = 30
): Promise<IncidentContext | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, createdAt: true, serviceId: true },
  });

  if (!incident) return null;

  const windowStart = new Date(incident.createdAt.getTime() - windowMinutes * 60 * 1000);
  const windowEnd = new Date(incident.createdAt.getTime() + windowMinutes * 60 * 1000);

  // Fetch Silver Tier: Aggregated Metrics
  const metricRollups = await prisma.metricRollup.findMany({
    where: {
      bucket: { gte: windowStart, lte: windowEnd },
      serviceId: incident.serviceId,
    },
    orderBy: { bucket: 'desc' },
    take: 100,
  });

  // Aggregate metrics by name
  const metricMap = new Map<string, { sum: number; count: number; min: number; max: number }>();
  for (const rollup of metricRollups) {
    const existing = metricMap.get(rollup.name) || {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    };
    existing.sum += rollup.sum;
    existing.count += rollup.count;
    existing.min = Math.min(existing.min, rollup.min ?? Infinity);
    existing.max = Math.max(existing.max, rollup.max ?? -Infinity);
    metricMap.set(rollup.name, existing);
  }

  const relatedMetrics = Array.from(metricMap.entries()).map(([name, data]) => ({
    name,
    avgValue: data.count > 0 ? data.sum / data.count : 0,
    count: data.count,
    minValue: data.min === Infinity ? 0 : data.min,
    maxValue: data.max === -Infinity ? 0 : data.max,
  }));

  // Fetch Bronze Tier: Raw Logs
  const logEntries = await prisma.logEntry.findMany({
    where: {
      timestamp: { gte: windowStart, lte: windowEnd },
      serviceId: incident.serviceId,
    },
    orderBy: { timestamp: 'desc' },
    take: 50,
    select: {
      id: true,
      level: true,
      message: true,
      timestamp: true,
      context: true,
    },
  });

  const relatedLogs = logEntries.map(log => ({
    id: log.id,
    level: log.level,
    message: log.message,
    timestamp: log.timestamp,
    context: log.context,
  }));

  return {
    incidentId,
    relatedMetrics,
    relatedLogs,
    timeWindow: { start: windowStart, end: windowEnd },
  };
}

/**
 * Attach context to incident as metadata
 * Stores enrichment data in incident event for audit trail
 */
export async function enrichIncident(incidentId: string): Promise<void> {
  const context = await getIncidentContext(incidentId);
  if (!context) return;

  // Build enrichment summary message
  const topMetrics = context.relatedMetrics
    .slice(0, 3)
    .map(m => `${m.name}: avg=${m.avgValue.toFixed(2)}, count=${m.count}`)
    .join('; ');

  const errorCount = context.relatedLogs.filter(
    l => l.level === 'error' || l.level === 'ERROR'
  ).length;

  const enrichmentMessage = [
    `Incident enriched with telemetry context`,
    `Time window: ${context.timeWindow.start.toISOString()} to ${context.timeWindow.end.toISOString()}`,
    `Related metrics: ${context.relatedMetrics.length} (${topMetrics || 'none'})`,
    `Related logs: ${context.relatedLogs.length} (${errorCount} errors)`,
  ].join('\n');

  // Create an incident event with enrichment data
  await prisma.incidentEvent.create({
    data: {
      incidentId,
      message: enrichmentMessage,
    },
  });
}
