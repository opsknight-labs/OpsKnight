'use client';

import { useState } from 'react';
import { formatDateTime, getBrowserTimeZone } from '@/lib/timezone';

interface Service {
    id: string;
    name: string;
    status: string;
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

interface StatusPageServicesGroupedProps {
    services: Service[];
    statusPageServices: StatusPageService[];
    incidents: Array<{
        serviceId: string;
        createdAt: Date;
        resolvedAt?: Date | null;
    }>;
}

const STATUS_CONFIG = {
    OPERATIONAL: {
        color: '#10b981',
        label: 'Operational',
    },
    DEGRADED: {
        color: '#f59e0b',
        label: 'Degraded',
    },
    PARTIAL_OUTAGE: {
        color: '#f59e0b',
        label: 'Partial Outage',
    },
    MAJOR_OUTAGE: {
        color: '#ef4444',
        label: 'Major Outage',
    },
    MAINTENANCE: {
        color: 'var(--status-primary, #3b82f6)',
        label: 'Maintenance',
    },
};

type TimePeriod = '30d' | '90d' | 'all';

export default function StatusPageServicesGrouped({
    services,
    statusPageServices,
    incidents
}: StatusPageServicesGroupedProps) {
    const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('90d');

    // Calculate uptime for a service group
    const calculateUptime = (serviceIds: string[], periodStart: Date) => {
        const periodEnd = new Date();
        const totalMinutes = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60);

        // Get incidents for these services in the period
        const groupIncidents = incidents.filter(
            inc => serviceIds.includes(inc.serviceId) &&
                inc.createdAt >= periodStart &&
                (inc.resolvedAt || inc.createdAt) <= periodEnd
        );

        // Calculate downtime minutes
        let downtimeMinutes = 0;
        groupIncidents.forEach(incident => {
            const start = incident.createdAt;
            const end = incident.resolvedAt || periodEnd;
            const incidentMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
            downtimeMinutes += incidentMinutes;
        });

        const uptimePercent = totalMinutes > 0
            ? ((totalMinutes - downtimeMinutes) / totalMinutes) * 100
            : 100;

        return Math.max(0, Math.min(100, uptimePercent));
    };

    // Get period start date
    const getPeriodStart = (period: TimePeriod): Date => {
        const now = new Date();
        switch (period) {
            case '30d':
                return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            case '90d':
                return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            case 'all':
                return new Date(0); // All time
            default:
                return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        }
    };

    // Format period label
    const getPeriodLabel = (period: TimePeriod): string => {
        const now = new Date();
        const start = getPeriodStart(period);

        if (period === 'all') {
            return 'All time';
        }

        const browserTz = getBrowserTimeZone();
        const startFormatted = formatDateTime(start, browserTz, { format: 'short' });
        const endFormatted = formatDateTime(now, browserTz, { format: 'short' });
        const startMonth = startFormatted.split(',')[0]?.split(' ')[0] || 'Jan';
        const startYear = start.getFullYear();
        const endMonth = endFormatted.split(',')[0]?.split(' ')[0] || 'Jan';
        const endYear = now.getFullYear();

        return `${startMonth} ${startYear}-${endMonth} ${endYear}`;
    };

    // Group services by team
    const _groupedServices = services.reduce((acc, service) => {
        const groupName = service.team?.name || 'Other Services';
        if (!acc[groupName]) {
            acc[groupName] = [];
        }
        acc[groupName].push(service);
        return acc;
    }, {} as Record<string, Service[]>);

    // Get visible services
    let visibleServices: Service[] = [];
    if (statusPageServices.length === 0) {
        visibleServices = services;
    } else {
        const serviceMap = new Map(services.map(s => [s.id, s]));
        visibleServices = statusPageServices
            .filter(sp => sp.showOnPage)
            .map(sp => serviceMap.get(sp.serviceId))
            .filter(Boolean) as Service[];
    }

    // Regroup visible services
    const visibleGrouped = visibleServices.reduce((acc, service) => {
        const groupName = service.team?.name || 'Other Services';
        if (!acc[groupName]) {
            acc[groupName] = [];
        }
        acc[groupName].push(service);
        return acc;
    }, {} as Record<string, Service[]>);

    if (Object.keys(visibleGrouped).length === 0) return null;

    const periodStart = getPeriodStart(selectedPeriod);

    return (
        <section style={{ marginBottom: '3rem' }}>
            {/* Header with period selector */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2rem',
                flexWrap: 'wrap',
                gap: '1rem',
            }}>
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: '600',
                    color: 'var(--status-text, #111827)',
                    margin: 0,
                }}>
                    System status
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--status-text-muted, #6b7280)', marginRight: '0.5rem' }}>
                        {getPeriodLabel(selectedPeriod)}
                    </span>
                    <select
                        value={selectedPeriod}
                        onChange={(e) => setSelectedPeriod(e.target.value as TimePeriod)}
                        style={{
                            padding: '0.5rem 1rem',
                            border: '1px solid #e5e7eb',
                            borderRadius: '0.5rem',
                            fontSize: '0.875rem',
                            background: 'var(--status-panel-bg, #ffffff)',
                            color: 'var(--status-text, #374151)',
                            cursor: 'pointer',
                        }}
                    >
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                        <option value="all">All time</option>
                    </select>
                </div>
            </div>

            {/* Service Groups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {Object.entries(visibleGrouped).map(([groupName, groupServices]) => {
                    const serviceIds = groupServices.map(s => s.id);
                    const uptime = calculateUptime(serviceIds, periodStart);
                    const componentCount = groupServices.length;

                    // Determine group status (worst status in group)
                    const groupStatus = groupServices.reduce((worst, service) => {
                        const serviceStatus = service.status || 'OPERATIONAL';
                        const statusPriority = {
                            'MAJOR_OUTAGE': 4,
                            'PARTIAL_OUTAGE': 3,
                            'DEGRADED': 2,
                            'MAINTENANCE': 1,
                            'OPERATIONAL': 0,
                        };
                        const worstPriority = statusPriority[worst as keyof typeof statusPriority] || 0;
                        const currentPriority = statusPriority[serviceStatus as keyof typeof statusPriority] || 0;
                        return currentPriority > worstPriority ? serviceStatus : worst;
                    }, 'OPERATIONAL' as string);

                    const statusConfig = STATUS_CONFIG[groupStatus as keyof typeof STATUS_CONFIG] ||
                        STATUS_CONFIG.OPERATIONAL;

                    return (
                        <div
                            key={groupName}
                            style={{
                                border: '1px solid var(--status-panel-border, #e5e7eb)',
                                borderRadius: '0.75rem',
                                overflow: 'hidden',
                                background: 'var(--status-panel-bg, #ffffff)',
                            }}
                        >
                            {/* Group Header */}
                            <div style={{
                                padding: '1.5rem',
                                borderBottom: '1px solid var(--status-panel-border, #e5e7eb)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '1rem',
                            }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <h3 style={{
                                        fontSize: '1.125rem',
                                        fontWeight: '600',
                                        color: 'var(--status-text, #111827)',
                                        marginBottom: '0.25rem',
                                    }}>
                                        {groupName}
                                    </h3>
                                    <div style={{
                                        fontSize: '0.875rem',
                                        color: 'var(--status-text-muted, #6b7280)',
                                    }}>
                                        {componentCount} component{componentCount !== 1 ? 's' : ''}
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1.5rem',
                                    flexWrap: 'wrap',
                                }}>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{
                                            fontSize: '1.5rem',
                                            fontWeight: '600',
                                            color: 'var(--status-text, #111827)',
                                            lineHeight: '1.2',
                                        }}>
                                            {uptime.toFixed(2)}%
                                        </div>
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--status-text-muted, #6b7280)',
                                            marginTop: '0.25rem',
                                        }}>
                                            uptime
                                        </div>
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                    }}>
                                        <div style={{
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '50%',
                                            background: statusConfig.color,
                                        }}></div>
                                        <span style={{
                                            fontSize: '0.875rem',
                                            color: 'var(--status-text, #374151)',
                                            fontWeight: '500',
                                        }}>
                                            {statusConfig.label}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Components List */}
                            <div style={{
                                padding: '1rem 1.5rem',
                                background: 'var(--status-panel-muted-bg, #f9fafb)',
                            }}>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                    gap: '1rem',
                                }}>
                                    {groupServices.map((service) => {
                                        const serviceStatus = service.status || 'OPERATIONAL';
                                        const serviceStatusConfig = STATUS_CONFIG[serviceStatus as keyof typeof STATUS_CONFIG] ||
                                            STATUS_CONFIG.OPERATIONAL;
                                        const activeIncidents = service._count.incidents;

                                        return (
                                            <div
                                                key={service.id}
                                                style={{
                                                    padding: '0.75rem',
                                                    background: 'var(--status-panel-bg, #ffffff)',
                                                    border: '1px solid var(--status-panel-border, #e5e7eb)',
                                                    borderRadius: '0.5rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: '0.75rem',
                                                }}
                                            >
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '0.875rem',
                                                        fontWeight: '500',
                                                        color: 'var(--status-text, #111827)',
                                                        marginBottom: '0.25rem',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {service.name}
                                                    </div>
                                                    {activeIncidents > 0 && (
                                                        <div style={{
                                                            fontSize: '0.75rem',
                                                            color: '#ef4444',
                                                            fontWeight: '500',
                                                        }}>
                                                            {activeIncidents} incident{activeIncidents !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    background: serviceStatusConfig.color,
                                                    flexShrink: 0,
                                                }}></div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* View History Link */}
                            <div style={{
                                padding: '1rem 1.5rem',
                                borderTop: '1px solid var(--status-panel-border, #e5e7eb)',
                                background: 'var(--status-panel-bg, #ffffff)',
                            }}>
                                <a
                                    href="#incidents"
                                    style={{
                                        fontSize: '0.875rem',
                                        color: 'var(--status-primary, #3b82f6)',
                                        textDecoration: 'none',
                                        fontWeight: '500',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.textDecoration = 'underline';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.textDecoration = 'none';
                                    }}
                                >
                                    View history
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                </a>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}







