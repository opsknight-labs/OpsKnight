/**
 * Integration Metrics
 *
 * In-memory metrics tracking for webhooks and integrations.
 * Provides visibility into webhook performance and health.
 */

import { logger } from '@/lib/logger';

export interface IntegrationMetrics {
  totalReceived: number;
  totalSuccess: number;
  totalErrors: number;
  lastReceived: Date | null;
  lastSuccess: Date | null;
  lastError: Date | null;
  averageLatencyMs: number;
  latencySamples: number;
}

export interface MetricsByType {
  [integrationType: string]: IntegrationMetrics;
}

export interface MetricsByIntegration {
  [integrationId: string]: IntegrationMetrics;
}

interface MetricsState {
  byType: Map<string, IntegrationMetrics>;
  byIntegration: Map<string, IntegrationMetrics>;
  global: IntegrationMetrics;
}

// Initialize clean metrics object
function createEmptyMetrics(): IntegrationMetrics {
  return {
    totalReceived: 0,
    totalSuccess: 0,
    totalErrors: 0,
    lastReceived: null,
    lastSuccess: null,
    lastError: null,
    averageLatencyMs: 0,
    latencySamples: 0,
  };
}

// Global metrics state
const metricsState: MetricsState = {
  byType: new Map(),
  byIntegration: new Map(),
  global: createEmptyMetrics(),
};
const MAX_INTEGRATION_METRICS = 1000;
const MAX_TYPE_METRICS = 50;

function evictOldest(entries: Map<string, IntegrationMetrics>, capacity: number) {
  if (entries.size < capacity) return;
  let oldestKey: string | undefined;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [key, metrics] of entries) {
    const time = metrics.lastReceived?.getTime() ?? 0;
    if (time < oldestTime) {
      oldestKey = key;
      oldestTime = time;
    }
  }
  if (oldestKey) entries.delete(oldestKey);
}

/**
 * Update running average latency
 */
function updateAverageLatency(metrics: IntegrationMetrics, latencyMs: number): void {
  const oldSamples = metrics.latencySamples;
  const newSamples = oldSamples + 1;

  // Weighted running average
  metrics.averageLatencyMs = (metrics.averageLatencyMs * oldSamples + latencyMs) / newSamples;
  metrics.latencySamples = newSamples;
}

/**
 * Record a webhook received event
 */
export function recordWebhookReceived(
  integrationType: string,
  integrationId: string,
  success: boolean,
  latencyMs: number,
  errorCode?: string
): void {
  const now = new Date();

  // Ensure metrics objects exist
  let typeMetrics = metricsState.byType.get(integrationType);
  if (!typeMetrics) {
    evictOldest(metricsState.byType, MAX_TYPE_METRICS);
    typeMetrics = createEmptyMetrics();
    metricsState.byType.set(integrationType, typeMetrics);
  }
  let integrationMetrics = metricsState.byIntegration.get(integrationId);
  if (!integrationMetrics) {
    evictOldest(metricsState.byIntegration, MAX_INTEGRATION_METRICS);
    integrationMetrics = createEmptyMetrics();
    metricsState.byIntegration.set(integrationId, integrationMetrics);
  }

  const globalMetrics = metricsState.global;

  // Update all metric objects
  for (const metrics of [typeMetrics, integrationMetrics, globalMetrics]) {
    metrics.totalReceived += 1;
    metrics.lastReceived = now;
    updateAverageLatency(metrics, latencyMs); // Latency is passed in from route handler (which should use performance.now())

    if (success) {
      metrics.totalSuccess += 1;
      metrics.lastSuccess = now;
    } else {
      metrics.totalErrors += 1;
      metrics.lastError = now;
    }
  }

  // Log the event with high precision
  logger.info('integration.webhook_received', {
    integrationType,
    integrationId,
    success,
    latencyMs: Math.round(latencyMs * 100) / 100, // Round to 2 decimals
    errorCode,
  });
}

/**
 * Get metrics for a specific integration type
 */
export function getMetricsByType(integrationType: string): IntegrationMetrics {
  return metricsState.byType.get(integrationType) || createEmptyMetrics();
}

/**
 * Get metrics for a specific integration instance
 */
export function getMetricsByIntegration(integrationId: string): IntegrationMetrics {
  return metricsState.byIntegration.get(integrationId) || createEmptyMetrics();
}

/**
 * Get all metrics grouped by type
 */
export function getAllMetricsByType(): MetricsByType {
  return Object.fromEntries(metricsState.byType);
}

/**
 * Get global metrics across all integrations
 */
export function getGlobalMetrics(): IntegrationMetrics {
  return { ...metricsState.global };
}

/**
 * Get comprehensive metrics summary
 */
export function getMetricsSummary(): {
  global: IntegrationMetrics;
  byType: MetricsByType;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  errorRate: number;
} {
  const global = getGlobalMetrics();

  // Calculate error rate
  const errorRate =
    global.totalReceived > 0 ? (global.totalErrors / global.totalReceived) * 100 : 0;

  // Determine health status
  let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (errorRate > 25) {
    healthStatus = 'unhealthy';
  } else if (errorRate > 10) {
    healthStatus = 'degraded';
  }

  return {
    global,
    byType: getAllMetricsByType(),
    healthStatus,
    errorRate: Math.round(errorRate * 100) / 100,
  };
}

/**
 * Reset all metrics (for testing)
 */
export function resetAllMetrics(): void {
  metricsState.byType.clear();
  metricsState.byIntegration.clear();
  metricsState.global = createEmptyMetrics();
}

/**
 * Reset metrics for a specific integration
 */
export function resetIntegrationMetrics(integrationId: string): void {
  metricsState.byIntegration.delete(integrationId);
}

/**
 * Serialize metrics for JSON response
 */
export function serializeMetrics(metrics: IntegrationMetrics): Record<string, unknown> {
  return {
    totalReceived: metrics.totalReceived,
    totalSuccess: metrics.totalSuccess,
    totalErrors: metrics.totalErrors,
    successRate:
      metrics.totalReceived > 0
        ? Math.round((metrics.totalSuccess / metrics.totalReceived) * 10000) / 100
        : 100,
    averageLatencyMs: Math.round(metrics.averageLatencyMs * 100) / 100,
    lastReceived: metrics.lastReceived?.toISOString() || null,
    lastSuccess: metrics.lastSuccess?.toISOString() || null,
    lastError: metrics.lastError?.toISOString() || null,
  };
}

// Cleanup mechanism to prevent memory leaks from unused integrations
const METRICS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanupTimer() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();

    // Clean up integration metrics
    for (const [id, metrics] of metricsState.byIntegration) {
      const lastActivity = metrics.lastReceived?.getTime() || 0;
      if (now - lastActivity > METRICS_TTL_MS) {
        metricsState.byIntegration.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent Node from exiting
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

// Start cleanup on module load
if (typeof setInterval !== 'undefined') {
  startCleanupTimer();
}
