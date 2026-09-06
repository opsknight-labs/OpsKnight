'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, getBrowserTimeZone } from '@/lib/timezone';

interface Service {
  id: string;
  name: string;
  status: string;
  region?: string | null;
  slaTier?: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
  _count: {
    incidents: number;
  };
}

interface StatusPageService {
  id: string;
  serviceId: string;
  displayName?: string | null;
  showOnPage: boolean;
}

interface PrivacySettings {
  showServiceMetrics?: boolean;
  showServiceDescriptions?: boolean;
  showServiceRegions?: boolean;
  showUptimeHistory?: boolean;
  showTeamInformation?: boolean;
}

interface StatusPageServicesProps {
  services: Service[];
  statusPageServices: StatusPageService[];
  uptime90: Record<string, number>;
  incidents: Array<{
    serviceId: string;
    createdAt: string;
    resolvedAt?: string | null;
    status: string;
    urgency: string;
  }>;
  privacySettings?: PrivacySettings;
  groupByRegionDefault?: boolean;
  showServiceOwners?: boolean;
  showServiceSlaTier?: boolean;
}

const STATUS_CONFIG = {
  OPERATIONAL: {
    color: '#16a34a',
    label: 'Operational',
    background: '#dcfce7',
    border: '#86efac',
  },
  DEGRADED: {
    color: '#d97706',
    label: 'Degraded',
    background: '#fef3c7',
    border: '#fcd34d',
  },
  PARTIAL_OUTAGE: {
    color: '#d97706',
    label: 'Partial Outage',
    background: '#fef3c7',
    border: '#fcd34d',
  },
  MAJOR_OUTAGE: {
    color: '#dc2626',
    label: 'Major Outage',
    background: '#fee2e2',
    border: '#fca5a5',
  },
  MAINTENANCE: {
    color: 'var(--status-primary, #2563eb)',
    label: 'Maintenance',
    background: 'color-mix(in srgb, var(--status-primary, #2563eb) 12%, #ffffff)',
    border: 'color-mix(in srgb, var(--status-primary, #2563eb) 40%, #ffffff)',
  },
};

const HISTORY_STATUS_COLORS: Record<'operational' | 'degraded' | 'outage' | 'future', string> = {
  operational: '#16a34a', // Brighter, more visible green
  degraded: '#d97706', // Brighter, more visible orange/yellow
  outage: '#dc2626', // Brighter, more visible red
  future: '#cbd5e1', // Slightly darker grey for better visibility
};

type HoveredBar = {
  serviceId: string;
  date: string;
  left: number;
  width: number;
};

type TimelineSliceStatus = 'operational' | 'degraded' | 'outage' | 'future';

export default function StatusPageServices({
  services,
  statusPageServices,
  uptime90,
  incidents,
  privacySettings,
  groupByRegionDefault,
  showServiceOwners,
  showServiceSlaTier,
}: StatusPageServicesProps) {
  // Privacy defaults
  const privacy = {
    showServiceMetrics: privacySettings?.showServiceMetrics !== false,
    showServiceDescriptions: privacySettings?.showServiceDescriptions !== false,
    showServiceRegions: privacySettings?.showServiceRegions !== false,
    showUptimeHistory: privacySettings?.showUptimeHistory !== false,
    showTeamInformation: privacySettings?.showTeamInformation === true,
  };
  const [hoveredBar, setHoveredBar] = useState<HoveredBar | null>(null);
  const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);
  const [visibleDays, setVisibleDays] = useState(90);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'operational' | 'degraded' | 'outage' | 'maintenance'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByRegion, setGroupByRegion] = useState(() => Boolean(groupByRegionDefault));

  const now = useMemo(() => new Date(), []);
  const daysToShow = 90;

  useEffect(() => {
    const updateVisibleDays = () => {
      const width = window.innerWidth;
      if (width < 1024) {
        setVisibleDays(30);
      } else if (width < 1440) {
        setVisibleDays(60);
      } else {
        setVisibleDays(90);
      }
    };

    updateVisibleDays();
    window.addEventListener('resize', updateVisibleDays);
    return () => window.removeEventListener('resize', updateVisibleDays);
  }, []);

  const incidentsByService = useMemo(() => {
    const map: Record<
      string,
      Array<{
        createdAt: Date;
        resolvedAt?: Date | null;
        status: string;
        urgency: string;
      }>
    > = {};

    incidents.forEach(incident => {
      if (!map[incident.serviceId]) {
        map[incident.serviceId] = [];
      }

      map[incident.serviceId].push({
        createdAt: new Date(incident.createdAt),
        resolvedAt: incident.resolvedAt ? new Date(incident.resolvedAt) : null,
        status: incident.status,
        urgency: incident.urgency,
      });
    });

    return map;
  }, [incidents]);

  const historyByService = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (daysToShow - 1));

    const historyMap: Record<
      string,
      Array<{ date: string; status: 'operational' | 'degraded' | 'outage' }>
    > = {};
    services.forEach(service => {
      historyMap[service.id] = [];
    });

    for (let i = 0; i < daysToShow; i += 1) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const dayKey = formatLocalDateKey(dayStart);

      services.forEach(service => {
        const active = (incidentsByService[service.id] || []).filter(incident => {
          if (incident.status === 'SUPPRESSED' || incident.status === 'SNOOZED') {
            return false;
          }
          const incidentEnd = incident.resolvedAt || now;
          return incident.createdAt < dayEnd && incidentEnd > dayStart;
        });

        const hasOutage = active.some(incident => incident.urgency === 'HIGH');
        const hasDegraded = active.some(
          incident => incident.urgency === 'MEDIUM' || incident.urgency === 'LOW'
        );
        const status = hasOutage ? 'outage' : hasDegraded ? 'degraded' : 'operational';

        historyMap[service.id].push({
          date: dayKey,
          status,
        });
      });
    }

    return historyMap;
  }, [services, incidentsByService, now]);

  const activeTimelineData = useMemo(() => {
    if (!hoveredBar) return null;

    const { serviceId, date } = hoveredBar;
    const [year, month, day] = date.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

    const slices: TimelineSliceStatus[] = new Array(144).fill('operational');
    const relevantIncidents = (incidentsByService[serviceId] || []).filter(incident => {
      if (incident.status === 'SUPPRESSED' || incident.status === 'SNOOZED') {
        return false;
      }
      const incidentEnd = incident.resolvedAt || now;
      return incident.createdAt < dayEnd && incidentEnd > dayStart;
    });

    const severityRank: Record<TimelineSliceStatus, number> = {
      operational: 0,
      degraded: 1,
      outage: 2,
      future: -1,
    };

    relevantIncidents.forEach(incident => {
      const incidentStart = incident.createdAt > dayStart ? incident.createdAt : dayStart;
      const incidentEnd =
        (incident.resolvedAt || now) < dayEnd ? incident.resolvedAt || now : dayEnd;
      const startIndex = Math.floor(
        (incidentStart.getTime() - dayStart.getTime()) / (10 * 60 * 1000)
      );
      const endIndex =
        Math.ceil((incidentEnd.getTime() - dayStart.getTime()) / (10 * 60 * 1000)) - 1;

      const statusForIncident: TimelineSliceStatus =
        incident.urgency === 'HIGH'
          ? 'outage'
          : incident.urgency === 'MEDIUM' || incident.urgency === 'LOW'
            ? 'degraded'
            : 'operational';

      for (let i = Math.max(0, startIndex); i <= Math.min(143, endIndex); i += 1) {
        if (severityRank[statusForIncident] > severityRank[slices[i]]) {
          slices[i] = statusForIncident;
        }
      }
    });

    const isToday = dayStart.toDateString() === now.toDateString();
    if (isToday) {
      const currentIndex = Math.floor((now.getTime() - dayStart.getTime()) / (10 * 60 * 1000));
      for (let i = Math.max(0, currentIndex + 1); i < slices.length; i += 1) {
        slices[i] = 'future';
      }
    }

    return { date, status: slices };
  }, [hoveredBar, incidentsByService, now]);

  const getIncidentStartMarkers = (serviceId: string, date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

    const markerMap = new Map<number, string>();
    const times: string[] = [];
    (incidentsByService[serviceId] || []).forEach(incident => {
      if (incident.status === 'SUPPRESSED' || incident.status === 'SNOOZED') {
        return;
      }
      if (incident.resolvedAt) {
        return;
      }
      if (incident.createdAt < dayStart || incident.createdAt >= dayEnd) {
        return;
      }
      const index = Math.floor(
        (incident.createdAt.getTime() - dayStart.getTime()) / (10 * 60 * 1000)
      );
      const browserTz = getBrowserTimeZone();
      const label = formatDateTime(incident.createdAt, browserTz, {
        format: 'time',
        hour12: false,
      });
      markerMap.set(Math.max(0, Math.min(143, index)), label);
      times.push(label);
    });

    return {
      markers: Array.from(markerMap.entries()).map(([index, label]) => ({ index, label })),
      times: times.sort(),
    };
  };

  const formatTooltipDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);
    return formatDateTime(date, getBrowserTimeZone(), { format: 'date' });
  };

  const getRegionList = (region?: string | null) => {
    if (!region) return [];
    return region
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
  };
  // If statusPageServices is empty, show all services
  // Otherwise, only show configured services
  const visibleServices = useMemo(() => {
    if (statusPageServices.length === 0) {
      // No services configured, show all services
      return services.map(service => ({
        ...service,
        displayName: service.name,
      }));
    } else {
      // Show only configured services
      return statusPageServices
        .filter(sp => sp.showOnPage)
        .map(sp => {
          const service = services.find(s => s.id === sp.serviceId);
          if (!service) return null;
          return {
            ...service,
            displayName: sp.displayName || service.name,
          };
        })
        .filter(Boolean) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }, [services, statusPageServices]);

  const normalizeStatus = (status: string) => {
    if (status === 'MAJOR_OUTAGE') return 'outage';
    if (status === 'PARTIAL_OUTAGE' || status === 'DEGRADED') return 'degraded';
    if (status === 'MAINTENANCE') return 'maintenance';
    return 'operational';
  };

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleServices.filter(service => {
      const statusKey = normalizeStatus(service.status || 'OPERATIONAL');
      if (statusFilter !== 'all' && statusKey !== statusFilter) {
        return false;
      }
      if (query) {
        const name = (service.displayName || service.name || '').toLowerCase();
        if (!name.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [visibleServices, statusFilter, searchQuery]);

  const hasAnyRegion = useMemo(
    () => visibleServices.some(service => getRegionList(service.region).length > 0),
    [visibleServices]
  );

  useEffect(() => {
    setGroupByRegion(Boolean(groupByRegionDefault));
  }, [groupByRegionDefault]);

  useEffect(() => {
    if (!privacy.showServiceRegions || !hasAnyRegion) {
      setGroupByRegion(false);
    }
  }, [privacy.showServiceRegions, hasAnyRegion]);

  const regionGroups = useMemo(() => {
    if (!groupByRegion || !privacy.showServiceRegions) {
      return [];
    }
    const groupMap = new Map<string, Service[]>();
    filteredServices.forEach(service => {
      const regions = getRegionList(service.region);
      const groupKey =
        regions.length === 0 ? 'Global' : regions.length === 1 ? regions[0] : 'Multi-region';
      const existing = groupMap.get(groupKey) || [];
      existing.push(service);
      groupMap.set(groupKey, existing);
    });

    const entries = Array.from(groupMap.entries());
    const priority = (value: string) => {
      if (value === 'Multi-region') return 1;
      if (value === 'Unspecified') return 2;
      return 0;
    };
    entries.sort((a, b) => {
      const priorityDiff = priority(a[0]) - priority(b[0]);
      if (priorityDiff !== 0) return priorityDiff;
      return a[0].localeCompare(b[0]);
    });

    return entries.map(([region, services]) => ({ region, services }));
  }, [filteredServices, groupByRegion, privacy.showServiceRegions]);

  if (visibleServices.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderServiceCard = (service: any, index: number) => {
    const serviceStatus = service.status || 'OPERATIONAL';
    const statusConfig = STATUS_CONFIG[serviceStatus as keyof typeof STATUS_CONFIG] || {
      color: '#475569',
      label: 'Unknown',
      background: '#f1f5f9',
      border: '#cbd5e1',
    };
    const activeIncidents = service._count.incidents;
    const serviceHistory = historyByService[service.id] || [];
    const displayedHistory = serviceHistory.slice(-visibleDays);
    const uptimeValue90 = uptime90[service.id];
    const hoveredTimeline =
      hoveredBar && hoveredBar.serviceId === service.id ? activeTimelineData : null;
    const hoveredMarkerData =
      hoveredBar && hoveredBar.serviceId === service.id
        ? getIncidentStartMarkers(service.id, hoveredBar.date)
        : { markers: [], times: [] };
    const isRowHovered = hoveredServiceId === service.id;
    const isTooltipActive = hoveredBar?.serviceId === service.id;

    return (
      <div
        key={service.id}
        className="status-service-card"
        data-service-row="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(0.75rem, 2vw, 1rem)',
          padding: 'clamp(1rem, 3vw, 1.5rem)',
          borderTop: index === 0 ? 'none' : '1px solid #e2e8f0',
          position: 'relative',
          background: isRowHovered
            ? `linear-gradient(90deg, ${statusConfig.background}08 0%, #ffffff 100%)`
            : '#ffffff',
          borderLeft: `4px solid ${isRowHovered ? statusConfig.color : 'transparent'}`,
          transition: 'all 0.2s ease',
          transform: isRowHovered ? 'translateX(2px)' : 'none',
          overflow: 'visible',
          zIndex: isTooltipActive ? 30 : isRowHovered ? 10 : 1,
        }}
        onMouseEnter={() => setHoveredServiceId(service.id)}
        onMouseLeave={e => {
          const relatedTarget = e.relatedTarget;
          if (relatedTarget instanceof Element && relatedTarget.closest('[data-tooltip]')) {
            return;
          }
          setHoveredServiceId(current => (current === service.id ? null : current));
          setHoveredBar(current => (current && current.serviceId === service.id ? null : current));
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'clamp(1rem, 3vw, 1.5rem)',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            <div
              style={{
                fontSize: 'clamp(1rem, 2.5vw, 1.125rem)',
                fontWeight: '700',
                color: 'var(--status-text-strong, #0f172a)',
                wordBreak: 'break-word',
                marginBottom: '0.5rem',
                letterSpacing: '-0.01em',
              }}
            >
              {service.displayName}
            </div>
            {(showServiceOwners && privacy.showTeamInformation && service.team?.name) ||
            (showServiceSlaTier && service.slaTier) ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '0.5rem',
                }}
              >
                {showServiceOwners && privacy.showTeamInformation && service.team?.name && (
                  <span
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      background: 'var(--status-panel-muted-bg, #f8fafc)',
                      border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                      color: 'var(--status-text-muted, #475569)',
                    }}
                  >
                    Owned by {service.team.name}
                  </span>
                )}
                {showServiceSlaTier && service.slaTier && (
                  <span
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      background: 'var(--status-panel-muted-bg, #f8fafc)',
                      border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                      color: 'var(--status-text-muted, #475569)',
                    }}
                  >
                    SLA: {service.slaTier}
                  </span>
                )}
              </div>
            ) : null}
            {privacy.showServiceRegions && getRegionList(service.region).length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '0.5rem',
                }}
              >
                {getRegionList(service.region).map(region => (
                  <span
                    key={`${service.id}-${region}`}
                    style={{
                      padding: '0.25rem 0.65rem',
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      background: 'var(--status-panel-muted-bg, #f8fafc)',
                      border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                      color: 'var(--status-text-muted, #475569)',
                    }}
                  >
                    {region}
                  </span>
                ))}
              </div>
            )}
            {privacy.showServiceDescriptions && service.description && (
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  color: 'var(--status-text-muted, #64748b)',
                  lineHeight: '1.6',
                }}
              >
                {service.description}
              </p>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: 'flex-end',
              minWidth: '160px',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: '700',
                color: statusConfig.color,
                background: statusConfig.background,
                border: `2px solid ${statusConfig.border}`,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
                boxShadow: `0 2px 4px ${statusConfig.border}30`,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={event => {
                event.currentTarget.style.transform = 'scale(1.05)';
                event.currentTarget.style.boxShadow = `0 4px 8px ${statusConfig.border}50`;
              }}
              onMouseLeave={event => {
                event.currentTarget.style.transform = 'scale(1)';
                event.currentTarget.style.boxShadow = `0 2px 4px ${statusConfig.border}30`;
              }}
            >
              {statusConfig.label}
            </span>
            {activeIncidents > 0 && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--status-text-muted, #6b7280)',
                  fontWeight: '600',
                }}
              >
                {activeIncidents} active incident{activeIncidents !== 1 ? 's' : ''}
              </div>
            )}
            {privacy.showServiceMetrics && uptimeValue90 !== undefined && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  fontSize: '0.8125rem',
                  color: 'var(--status-text-muted, #64748b)',
                  fontWeight: '500',
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
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
                <span>{uptimeValue90.toFixed(2)}% uptime (90d)</span>
              </div>
            )}
          </div>
        </div>

        {privacy.showUptimeHistory && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${displayedHistory.length || visibleDays}, minmax(0, 1fr))`,
              gap: '2px',
              height: '28px',
              padding: '0.55rem 0.8rem',
              alignItems: 'center',
              width: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden',
              borderRadius: '0.75rem',
              background: 'var(--status-panel-bg, #ffffff)',
              border: '1px solid var(--status-panel-border, #e2e8f0)',
              boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.08)',
            }}
          >
            {(displayedHistory.length ? displayedHistory : new Array(visibleDays).fill(null)).map(
              (entry, barIndex) => {
                const barStatus = entry?.status || 'operational';
                const isHovered =
                  hoveredBar?.serviceId === service.id && hoveredBar?.date === entry?.date;

                return (
                  <div
                    key={`${service.id}-${barIndex}`}
                    style={{
                      position: 'relative',
                      height: '100%',
                      background:
                        HISTORY_STATUS_COLORS[barStatus as 'operational' | 'degraded' | 'outage'],
                      borderRadius: '3px',
                      boxShadow: isHovered ? '0 0 0 1px #0f172a' : 'none',
                      cursor: entry ? 'pointer' : 'default',
                      transition: 'all 0.15s ease',
                      border: isHovered ? '1px solid #0f172a' : '1px solid transparent',
                    }}
                    onMouseEnter={event => {
                      if (entry) {
                        const barRect = (
                          event.currentTarget as HTMLDivElement
                        ).getBoundingClientRect();
                        const rowElement = (event.currentTarget as HTMLDivElement).closest(
                          '[data-service-row]'
                        );
                        const rowRect = rowElement ? rowElement.getBoundingClientRect() : barRect;
                        const tooltipWidth = Math.max(600, Math.min(1100, rowRect.width - 16));
                        const center = barRect.left - rowRect.left + barRect.width / 2;
                        const half = tooltipWidth / 2;
                        const padding = 12;
                        const clamped = Math.max(
                          half + padding,
                          Math.min(rowRect.width - half - padding, center)
                        );

                        setHoveredBar({
                          serviceId: service.id,
                          date: entry.date,
                          left: clamped,
                          width: tooltipWidth,
                        });
                      }
                    }}
                    onMouseLeave={event => {
                      const relatedTarget = (event as any).relatedTarget as HTMLElement | null; // eslint-disable-line @typescript-eslint/no-explicit-any
                      if (relatedTarget && relatedTarget.closest('[data-tooltip]')) {
                        return;
                      }
                      setHoveredBar(current =>
                        current?.serviceId === service.id && current?.date === entry?.date
                          ? null
                          : current
                      );
                    }}
                    onClick={event => {
                      if (!entry) return;
                      const barRect = (
                        event.currentTarget as HTMLDivElement
                      ).getBoundingClientRect();
                      const rowElement = (event.currentTarget as HTMLDivElement).closest(
                        '[data-service-row]'
                      );
                      const rowRect = rowElement ? rowElement.getBoundingClientRect() : barRect;
                      const tooltipWidth = Math.max(600, Math.min(1100, rowRect.width - 16));
                      const center = barRect.left - rowRect.left + barRect.width / 2;
                      const half = tooltipWidth / 2;
                      const padding = 12;
                      const clamped = Math.max(
                        half + padding,
                        Math.min(rowRect.width - half - padding, center)
                      );

                      setHoveredBar(current => {
                        if (
                          current &&
                          current.serviceId === service.id &&
                          current.date === entry.date
                        ) {
                          return null;
                        }
                        return {
                          serviceId: service.id,
                          date: entry.date,
                          left: clamped,
                          width: tooltipWidth,
                        };
                      });
                    }}
                  />
                );
              }
            )}
          </div>
        )}
        {hoveredBar &&
          hoveredBar.serviceId === service.id &&
          (() => {
            const tooltipEntry = displayedHistory.find(e => e.date === hoveredBar.date);
            const dayStatus = tooltipEntry?.status || 'operational';
            const slaMetrics = hoveredTimeline
              ? hoveredTimeline.status.reduce(
                  (acc, status) => {
                    if (status !== 'future') {
                      acc.total += 1;
                      if (status === 'operational') {
                        acc.operational += 1;
                      }
                    }
                    return acc;
                  },
                  { total: 0, operational: 0 }
                )
              : { total: 0, operational: 0 };
            const slaValue =
              slaMetrics.total > 0 ? (slaMetrics.operational / slaMetrics.total) * 100 : 100;
            return (
              <div
                data-tooltip="true"
                style={{
                  position: 'absolute',
                  left: `${hoveredBar.left}px`,
                  top: '100%',
                  marginTop: '0.75rem',
                  background: 'var(--status-panel-bg, #ffffff)',
                  border: '2px solid var(--status-panel-border, #e2e8f0)',
                  borderRadius: '1rem',
                  padding: '1.25rem',
                  boxShadow: '0 20px 40px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                  zIndex: 100,
                  width: `${hoveredBar.width}px`,
                  maxWidth: '98vw',
                  transform: 'translateX(-50%)',
                  opacity: 1,
                  transition: 'opacity 0.2s ease, transform 0.2s ease',
                  overflow: 'hidden',
                }}
                onMouseLeave={() => {
                  setHoveredBar(null);
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    left: '50%',
                    width: '10px',
                    height: '10px',
                    background: 'var(--status-panel-bg, #ffffff)',
                    borderLeft: '1px solid var(--status-panel-border, #e2e8f0)',
                    borderTop: '1px solid var(--status-panel-border, #e2e8f0)',
                    transform: 'translateX(-50%) rotate(45deg)',
                  }}
                />
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setHoveredBar(null)}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    border: 'none',
                    background: '#f1f5f9',
                    color: 'var(--status-text-muted, #64748b)',
                    fontSize: '1.125rem',
                    cursor: 'pointer',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={event => {
                    event.currentTarget.style.background = '#e2e8f0';
                    event.currentTarget.style.color = '#475569';
                    event.currentTarget.style.transform = 'scale(1.1)';
                  }}
                  onMouseLeave={event => {
                    event.currentTarget.style.background = '#f1f5f9';
                    event.currentTarget.style.color = '#64748b';
                    event.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  x
                </button>
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: '700',
                    color: 'var(--status-text-strong, #0f172a)',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{formatTooltipDate(hoveredBar.date)}</span>
                  {tooltipEntry && (
                    <span
                      style={{
                        padding: '0.375rem 0.75rem',
                        borderRadius: '0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        background:
                          HISTORY_STATUS_COLORS[
                            dayStatus as 'operational' | 'degraded' | 'outage'
                          ] + '20',
                        color:
                          HISTORY_STATUS_COLORS[dayStatus as 'operational' | 'degraded' | 'outage'],
                        border: `2px solid ${HISTORY_STATUS_COLORS[dayStatus as 'operational' | 'degraded' | 'outage']}60`,
                        boxShadow: `0 2px 4px ${HISTORY_STATUS_COLORS[dayStatus as 'operational' | 'degraded' | 'outage']}30`,
                      }}
                    >
                      {dayStatus === 'operational'
                        ? 'Operational'
                        : dayStatus === 'degraded'
                          ? 'Degraded'
                          : 'Outage'}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--status-text-muted, #64748b)',
                    marginBottom: '0.35rem',
                  }}
                >
                  {service.displayName} - Local time
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--status-text-muted, #475569)',
                    marginBottom: '1rem',
                  }}
                >
                  SLA: {slaValue.toFixed(2)}% met
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    fontSize: '0.75rem',
                    color: 'var(--status-text-muted, #64748b)',
                    marginBottom: '1rem',
                    padding: '0.75rem',
                    background: 'var(--status-panel-muted-bg, #f8fafc)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: '500',
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: HISTORY_STATUS_COLORS.operational,
                        boxShadow: `0 0 0 2px ${HISTORY_STATUS_COLORS.operational}30`,
                      }}
                    />
                    Operational
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: '500',
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: HISTORY_STATUS_COLORS.degraded,
                        boxShadow: `0 0 0 2px ${HISTORY_STATUS_COLORS.degraded}30`,
                      }}
                    />
                    Degraded
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: '500',
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: HISTORY_STATUS_COLORS.outage,
                        boxShadow: `0 0 0 2px ${HISTORY_STATUS_COLORS.outage}30`,
                      }}
                    />
                    Outage
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: '500',
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '3px',
                        background: HISTORY_STATUS_COLORS.future,
                        boxShadow: `0 0 0 2px ${HISTORY_STATUS_COLORS.future}30`,
                      }}
                    />
                    Upcoming
                  </span>
                </div>
                {hoveredTimeline && (
                  <div>
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: '0',
                          height: '52px',
                          padding: '0.2rem 0.2rem',
                          background: 'var(--status-panel-muted-bg, #f8fafc)',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                          boxSizing: 'border-box',
                        }}
                      >
                        {hoveredTimeline.status.map((sliceStatus, sliceIndex) => (
                          <div
                            key={`${service.id}-${hoveredBar.date}-${sliceIndex}`}
                            style={(() => {
                              const sliceColor =
                                HISTORY_STATUS_COLORS[sliceStatus] ||
                                HISTORY_STATUS_COLORS.operational;
                              return {
                                flex: '1 1 0',
                                background: sliceColor,
                                borderRadius: '0',
                                height: '100%',
                                minHeight: '100%',
                                minWidth: '3px',
                                boxShadow: 'none',
                              };
                            })()}
                          />
                        ))}
                      </div>
                      {hoveredMarkerData.markers.map(marker => (
                        <span
                          key={`${service.id}-${hoveredBar.date}-marker-${marker.index}`}
                          title={marker.label}
                          style={{
                            position: 'absolute',
                            top: '0',
                            left: `${(marker.index / 144) * 100}%`,
                            width: '2px',
                            height: '100%',
                            background: '#0f172a',
                            opacity: 0.7,
                          }}
                        />
                      ))}
                    </div>
                    {hoveredMarkerData.times.length > 0 && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          fontSize: '0.75rem',
                          color: 'var(--status-text-muted, #64748b)',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.4rem',
                        }}
                      >
                        <span
                          style={{ fontWeight: '600', color: 'var(--status-text-muted, #475569)' }}
                        >
                          Starts:
                        </span>
                        {hoveredMarkerData.times.map((time, timeIndex) => (
                          <span
                            key={`${service.id}-${hoveredBar.date}-time-${timeIndex}`}
                            style={{
                              padding: '0.15rem 0.4rem',
                              borderRadius: '0.4rem',
                              background: 'var(--status-panel-muted-bg, #f1f5f9)',
                            }}
                          >
                            {time}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.7rem',
                        color: 'var(--status-text-subtle, #94a3b8)',
                        marginTop: '0.35rem',
                      }}
                    >
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>24:00</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
      </div>
    );
  };

  return (
    <section style={{ marginBottom: 'clamp(2rem, 6vw, 4rem)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'clamp(1rem, 3vw, 1.5rem)',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 1.875rem)',
              fontWeight: '800',
              color: 'var(--status-text-strong, #0f172a)',
              margin: 0,
              marginBottom: '0.25rem',
              letterSpacing: '-0.02em',
            }}
          >
            Services
          </h2>
          <p
            style={{
              fontSize: 'clamp(0.8125rem, 2vw, 0.875rem)',
              color: 'var(--status-text-muted, #64748b)',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            {filteredServices.length} of {visibleServices.length} services
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search services"
            className="status-page-input"
            style={{
              minWidth: '180px',
            }}
          />
          {(['all', 'operational', 'degraded', 'outage', 'maintenance'] as const).map(filter => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className="status-page-button"
              data-active={statusFilter === filter}
              style={{ textTransform: 'capitalize' }}
            >
              {filter}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setGroupByRegion(prev => !prev)}
            className="status-page-button"
            data-active={groupByRegion}
            disabled={!privacy.showServiceRegions || !hasAnyRegion}
            title={
              !privacy.showServiceRegions
                ? 'Enable regions in privacy settings to group by region.'
                : !hasAnyRegion
                  ? 'No regions configured for these services.'
                  : 'Group services by region.'
            }
          >
            Group by region
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'clamp(0.75rem, 2vw, 1.25rem)',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 'clamp(1rem, 3vw, 1.5rem)',
          padding: 'clamp(0.75rem, 2vw, 1rem) clamp(1rem, 3vw, 1.25rem)',
          background: 'var(--status-panel-muted-bg, #f8fafc)',
          borderRadius: '0.75rem',
          border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
          boxShadow: 'none',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--status-text-muted, #475569)',
            fontWeight: '500',
          }}
        >
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              background: HISTORY_STATUS_COLORS.operational,
              boxShadow: '0 2px 4px rgba(34, 197, 94, 0.3)',
            }}
          />
          Operational
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--status-text-muted, #475569)',
            fontWeight: '500',
          }}
        >
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              background: HISTORY_STATUS_COLORS.degraded,
              boxShadow: '0 2px 4px rgba(251, 191, 36, 0.3)',
            }}
          />
          Degraded
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--status-text-muted, #475569)',
            fontWeight: '500',
          }}
        >
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              background: HISTORY_STATUS_COLORS.outage,
              boxShadow: '0 2px 4px rgba(248, 113, 113, 0.3)',
            }}
          />
          Outage
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--status-text-muted, #64748b)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
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
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          Last {visibleDays} days
        </span>
      </div>
      <div
        style={{
          border: '1px solid var(--status-panel-border, #e2e8f0)',
          borderRadius: '1rem',
          background: 'var(--status-panel-bg, #ffffff)',
          overflow: 'visible',
          boxShadow: 'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.05))',
          position: 'relative',
        }}
      >
        {filteredServices.length === 0 ? (
          <div
            style={{
              padding: '2.5rem',
              textAlign: 'center',
              color: 'var(--status-text-muted, #6b7280)',
              fontSize: '0.875rem',
            }}
          >
            No services match your filters.
          </div>
        ) : groupByRegion && regionGroups.length > 0 ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.25rem' }}
          >
            {regionGroups.map(group => {
              const groupStatuses = group.services.map(service =>
                normalizeStatus(service.status || 'OPERATIONAL')
              );
              const hasOutage = groupStatuses.includes('outage');
              const hasDegraded = groupStatuses.includes('degraded');
              const hasMaintenance = groupStatuses.includes('maintenance');
              const groupLabel = hasOutage
                ? { label: 'Outage', color: '#dc2626', background: '#fee2e2', border: '#fecaca' }
                : hasDegraded
                  ? {
                      label: 'Degraded',
                      color: '#d97706',
                      background: '#fef3c7',
                      border: '#fde68a',
                    }
                  : hasMaintenance
                    ? {
                        label: 'Maintenance',
                        color: 'var(--status-primary, #2563eb)',
                        background:
                          'color-mix(in srgb, var(--status-primary, #2563eb) 18%, #ffffff)',
                        border: 'color-mix(in srgb, var(--status-primary, #2563eb) 35%, #ffffff)',
                      }
                    : {
                        label: 'Operational',
                        color: '#16a34a',
                        background: '#dcfce7',
                        border: '#86efac',
                      };

              return (
                <div
                  key={group.region}
                  style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div
                        style={{
                          fontSize: '1rem',
                          fontWeight: '700',
                          color: 'var(--status-text-strong, #0f172a)',
                        }}
                      >
                        {group.region}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8125rem',
                          color: 'var(--status-text-muted, #6b7280)',
                        }}
                      >
                        {group.services.length} service{group.services.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        color: groupLabel.color,
                        background: groupLabel.background,
                        border: `1px solid ${groupLabel.border}`,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {groupLabel.label}
                    </span>
                  </div>
                  <div
                    style={{
                      border: '1px solid var(--status-panel-border, #e2e8f0)',
                      borderRadius: '0.9rem',
                      overflow: 'visible',
                      background: 'var(--status-panel-bg, #ffffff)',
                    }}
                  >
                    {group.services.map((service, index) => renderServiceCard(service, index))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          filteredServices.map((service, index) => renderServiceCard(service, index))
        )}
      </div>
    </section>
  );
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
