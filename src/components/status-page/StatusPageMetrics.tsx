'use client';

import { useMemo, useState, useEffect } from 'react';
import LoadingWrapper from '@/components/ui/LoadingWrapper';
import _Skeleton, { SkeletonCard } from '@/components/ui/Skeleton';

interface Incident {
  id: string;
  serviceId: string;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
  status: string;
  urgency: string;
}

interface Service {
  id: string;
  name: string;
}

interface StatusPageMetricsProps {
  services: Service[];
  incidents: Incident[];
  thirtyDaysAgo: Date | string;
  ninetyDaysAgo: Date | string;
  uptimeExcellentThreshold?: number;
  uptimeGoodThreshold?: number;
}

// Helper function to format percentage consistently (SSR-safe)
function formatUptimePercent(value: number): string {
  // Clamp value between 0 and 100, then round to 3 decimal places
  const clamped = Math.max(0, Math.min(100, isNaN(value) ? 100 : value));
  // Round to avoid floating point precision issues
  const rounded = Math.round(clamped * 1000) / 1000;
  return rounded.toFixed(3);
}

// Helper to separate logic from component with interval merging to avoid multiplying overlapping downtime
function calculateServiceUptime(
  serviceId: string,
  incidents: Incident[],
  periodStart: Date | string,
  periodEnd: Date | string
) {
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const totalMs = endMs - startMs;
  const totalMinutes = totalMs / (1000 * 60);

  if (totalMinutes <= 0 || isNaN(totalMinutes)) {
    return {
      uptime: 100,
      downtime: 0,
      incidents: 0,
    };
  }

  const serviceIncidents = incidents.filter(incident => {
    if (incident.status === 'SUPPRESSED' || incident.status === 'SNOOZED') {
      return false;
    }

    const createdAt = new Date(incident.createdAt).getTime();
    const resolvedAt = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : endMs;

    return incident.serviceId === serviceId && createdAt < endMs && resolvedAt > startMs;
  });

  // Create clipped intervals within [startMs, endMs]
  const intervals = serviceIncidents
    .map(incident => {
      const createdAt = new Date(incident.createdAt).getTime();
      const resolvedAt = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : endMs;
      const start = Math.max(startMs, createdAt);
      const end = Math.min(endMs, resolvedAt);
      return { start, end };
    })
    .filter(interval => interval.start < interval.end)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping intervals so concurrent incidents do not multiply downtime
  let downtimeMs = 0;
  if (intervals.length > 0) {
    let current = { start: intervals[0].start, end: intervals[0].end };
    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i];
      if (next.start <= current.end) {
        if (next.end > current.end) {
          current.end = next.end;
        }
      } else {
        downtimeMs += current.end - current.start;
        current = { start: next.start, end: next.end };
      }
    }
    downtimeMs += current.end - current.start;
  }

  const downtimeMinutes = downtimeMs / (1000 * 60);
  const uptimeMinutes = Math.max(0, totalMinutes - downtimeMinutes);
  const rawPercent = (uptimeMinutes / totalMinutes) * 100;
  const uptimePercent = Math.max(0, Math.min(100, Math.round(rawPercent * 1000) / 1000));

  return {
    uptime: uptimePercent,
    downtime: downtimeMinutes,
    incidents: serviceIncidents.length,
  };
}

export default function StatusPageMetrics({
  services,
  incidents,
  thirtyDaysAgo,
  ninetyDaysAgo,
  uptimeExcellentThreshold = 99.9,
  uptimeGoodThreshold = 99.0,
}: StatusPageMetricsProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const metrics = useMemo(() => {
    if (services.length === 0) {
      return [];
    }

    // Use current date for calculation
    const periodEnd = new Date();

    return services.map(service => ({
      service: service.name,
      thirtyDays: calculateServiceUptime(service.id, incidents, thirtyDaysAgo, periodEnd),
      ninetyDays: calculateServiceUptime(service.id, incidents, ninetyDaysAgo, periodEnd),
    }));
  }, [services, incidents, thirtyDaysAgo, ninetyDaysAgo]);

  if (services.length === 0) return null;

  const isLoading = !isClient || metrics.length === 0;

  return (
    <section style={{ marginBottom: 'clamp(2rem, 6vw, 4rem)' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2
          style={{
            fontSize: '1.875rem',
            fontWeight: '800',
            marginBottom: '0.25rem',
            color: 'var(--status-text-strong, #0f172a)',
            letterSpacing: '-0.02em',
          }}
        >
          Uptime Metrics
        </h2>
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--status-text-muted, #64748b)',
            margin: 0,
          }}
        >
          Service availability and performance statistics
        </p>
      </div>
      <LoadingWrapper
        isLoading={isLoading}
        variant="skeleton"
        skeletonLines={1}
        fallback={
          <div
            style={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            }}
          >
            {services.map(service => (
              <SkeletonCard key={service.id} />
            ))}
          </div>
        }
      >
        <div
          style={{
            display: 'grid',
            gap: '1.5rem',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          }}
        >
          {metrics.map(metric => {
            const getUptimeColor = (uptime: number) => {
              if (uptime >= uptimeExcellentThreshold)
                return {
                  bg: '#10b981',
                  gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                };
              if (uptime >= uptimeGoodThreshold)
                return {
                  bg: '#f59e0b',
                  gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                };
              return {
                bg: '#ef4444',
                gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              };
            };

            const thirtyColor = getUptimeColor(metric.thirtyDays.uptime);
            const ninetyColor = getUptimeColor(metric.ninetyDays.uptime);
            const slaBadge =
              metric.ninetyDays.uptime >= uptimeExcellentThreshold
                ? {
                    label: 'SLA Excellent',
                    color: '#047857',
                    background: '#dcfce7',
                    border: '#bbf7d0',
                  }
                : metric.ninetyDays.uptime >= uptimeGoodThreshold
                  ? {
                      label: 'SLA Good',
                      color: '#92400e',
                      background: '#fef3c7',
                      border: '#fde68a',
                    }
                  : {
                      label: 'Below SLA',
                      color: '#991b1b',
                      background: '#fee2e2',
                      border: '#fecaca',
                    };

            return (
              <div
                key={metric.service}
                style={{
                  padding: 'clamp(1.25rem, 3vw, 2rem)',
                  background: 'var(--status-panel-bg, #ffffff)',
                  border: '2px solid var(--status-panel-border, #e5e7eb)',
                  borderRadius: '1rem',
                  transition: 'all 0.3s ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow =
                    'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.06))';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'var(--status-card-shadow, none)';
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <h3
                  style={{
                    fontSize: 'clamp(1.125rem, 3vw, 1.375rem)',
                    fontWeight: '800',
                    marginBottom: 'clamp(1.25rem, 3vw, 1.75rem)',
                    color: 'var(--status-text, #111827)',
                    letterSpacing: '-0.02em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'clamp(0.5rem, 2vw, 0.75rem)',
                    wordBreak: 'break-word',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: ninetyColor.bg,
                      boxShadow: `0 0 0 4px ${ninetyColor.bg}20`,
                    }}
                  />
                  {metric.service}
                  <span
                    style={{
                      marginLeft: 'auto',
                      padding: '0.35rem 0.6rem',
                      borderRadius: '999px',
                      background: slaBadge.background,
                      color: slaBadge.color,
                      border: `1px solid ${slaBadge.border}`,
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {slaBadge.label}
                  </span>
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.875rem',
                          color: 'var(--status-text-muted, #6b7280)',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        30 Days
                      </span>
                      <span
                        style={{
                          fontSize: '1.125rem',
                          fontWeight: '800',
                          color: 'var(--status-text, #111827)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {formatUptimePercent(metric.thirtyDays.uptime)}%
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '12px',
                        background: 'var(--status-panel-muted-bg, #f1f5f9)',
                        borderRadius: '0.5rem',
                        overflow: 'hidden',
                        position: 'relative',
                        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, metric.thirtyDays.uptime))}%`,
                          height: '100%',
                          background: thirtyColor.gradient,
                          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: `0 2px 8px ${thirtyColor.bg}40`,
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background:
                              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                            animation: 'shimmer 2s infinite',
                          }}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--status-text-subtle, #9ca3af)',
                        marginTop: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      {metric.thirtyDays.incidents} incident
                      {metric.thirtyDays.incidents !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* 90 Days */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.875rem',
                          color: 'var(--status-text-muted, #6b7280)',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        90 Days
                      </span>
                      <span
                        style={{
                          fontSize: '1.125rem',
                          fontWeight: '800',
                          color: 'var(--status-text, #111827)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {formatUptimePercent(metric.ninetyDays.uptime)}%
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '12px',
                        background: 'var(--status-panel-muted-bg, #f1f5f9)',
                        borderRadius: '0.5rem',
                        overflow: 'hidden',
                        position: 'relative',
                        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, metric.ninetyDays.uptime))}%`,
                          height: '100%',
                          background: ninetyColor.gradient,
                          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: `0 2px 8px ${ninetyColor.bg}40`,
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background:
                              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                            animation: 'shimmer 2s infinite',
                          }}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--status-text-subtle, #9ca3af)',
                        marginTop: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      {metric.ninetyDays.incidents} incident
                      {metric.ninetyDays.incidents !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </LoadingWrapper>
      <style
        dangerouslySetInnerHTML={{
          __html: `
                @keyframes shimmer {
                    0% {
                        transform: translateX(-100%);
                    }
                    100% {
                        transform: translateX(100%);
                    }
                }
            `,
        }}
      />
    </section>
  );
}
