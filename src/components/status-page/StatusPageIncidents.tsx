'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBrowserTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

interface IncidentEvent {
    id: string;
    message: string;
    createdAt: Date;
}

interface Incident {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    urgency: string;
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
    service: {
        id: string;
        name: string;
        region?: string | null;
    };
    events: IncidentEvent[];
    postmortem?: {
        id: string;
        status: string;
        isPublic?: boolean | null;
    } | null;
}

interface PrivacySettings {
    showIncidentTitles?: boolean;
    showIncidentDescriptions?: boolean;
    showAffectedServices?: boolean;
    showServiceRegions?: boolean;
    showIncidentTimestamps?: boolean;
    showIncidentUrgency?: boolean;
    showIncidentDetails?: boolean;
}

interface StatusPageIncidentsProps {
    incidents: Incident[];
    privacySettings?: PrivacySettings;
    showPostIncidentReview?: boolean;
}

const INCIDENTS_PER_PAGE = 10;

export default function StatusPageIncidents({ incidents, privacySettings, showPostIncidentReview }: StatusPageIncidentsProps) {
    const browserTimeZone = useBrowserTimezone();
    const [expandedIncidents, setExpandedIncidents] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<'all' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'>('all');
    const [serviceFilter, setServiceFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Privacy defaults - show everything if not specified
    const privacy = {
        showIncidentTitles: privacySettings?.showIncidentTitles !== false,
        showIncidentDescriptions: privacySettings?.showIncidentDescriptions !== false,
        showAffectedServices: privacySettings?.showAffectedServices !== false,
        showServiceRegions: privacySettings?.showServiceRegions !== false,
        showIncidentTimestamps: privacySettings?.showIncidentTimestamps !== false,
        showIncidentUrgency: privacySettings?.showIncidentUrgency !== false,
        showIncidentDetails: privacySettings?.showIncidentDetails !== false,
    };

    const serviceOptions = useMemo(() => {
        const names = new Set<string>();
        incidents.forEach((incident) => {
            if (incident.service?.name) {
                names.add(incident.service.name);
            }
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [incidents]);

    const getRegionList = (region?: string | null) => {
        if (!region) return [];
        return region
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    };

    const filteredIncidents = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return incidents.filter((incident) => {
            if (statusFilter !== 'all' && incident.status !== statusFilter) {
                return false;
            }
            if (serviceFilter !== 'all' && incident.service?.name !== serviceFilter) {
                return false;
            }
            if (query) {
                const title = (incident.title || '').toLowerCase();
                const description = (incident.description || '').toLowerCase();
                if (!title.includes(query) && !description.includes(query)) {
                    return false;
                }
            }
            return true;
        });
    }, [incidents, statusFilter, serviceFilter, searchQuery]);

    useEffect(() => {
        setCurrentPage(1); // eslint-disable-line react-hooks/set-state-in-effect
    }, [statusFilter, serviceFilter, searchQuery]);

    const totalPages = Math.ceil(filteredIncidents.length / INCIDENTS_PER_PAGE);
    const startIndex = (currentPage - 1) * INCIDENTS_PER_PAGE;
    const endIndex = startIndex + INCIDENTS_PER_PAGE;
    const paginatedIncidents = filteredIncidents.slice(startIndex, endIndex);

    const toggleIncident = (id: string) => {
        const newSet = new Set(expandedIncidents);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIncidents(newSet);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'RESOLVED':
                return { bg: '#d1fae5', text: '#065f46', label: 'Resolved', border: '#10b981' };
            case 'ACKNOWLEDGED':
                return { bg: '#fef3c7', text: '#92400e', label: 'Acknowledged', border: '#f59e0b' };
            default:
                return { bg: '#fee2e2', text: '#991b1b', label: 'Investigating', border: '#ef4444' };
        }
    };

    const getResolutionNote = (events: IncidentEvent[]) => {
        const resolutionEvent = events.find((event) => /^resolved:/i.test(event.message))
            || events.find((event) => /^resolution:/i.test(event.message));
        if (!resolutionEvent) return null;
        const [, note] = resolutionEvent.message.split(/resolved:|resolution:/i);
        return (note || resolutionEvent.message).trim();
    };

    return (
        <section style={{ marginBottom: 'clamp(2rem, 6vw, 4rem)' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'clamp(1rem, 3vw, 1.5rem)',
                flexWrap: 'wrap',
                gap: '1rem',
            }}>
                <div>
                    <h2 style={{
                        fontSize: 'clamp(1.5rem, 4vw, 1.875rem)',
                        fontWeight: '800',
                        color: 'var(--status-text-strong, #0f172a)',
                        margin: 0,
                        marginBottom: '0.25rem',
                        letterSpacing: '-0.02em',
                    }}>
                        Recent Incidents
                    </h2>
                    {filteredIncidents.length > 0 && (
                        <p style={{
                            fontSize: 'clamp(0.8125rem, 2vw, 0.875rem)',
                            color: 'var(--status-text-muted, #64748b)',
                            margin: 0,
                        }}>
                            Showing {startIndex + 1}-{Math.min(endIndex, filteredIncidents.length)} of {filteredIncidents.length} incidents
                        </p>
                    )}
                </div>
            </div>

            {paginatedIncidents.length === 0 ? (
                <div style={{
                    padding: '5rem 2rem',
                    background: 'linear-gradient(135deg, var(--status-panel-bg, #ffffff) 0%, var(--status-panel-muted-bg, #f8fafc) 100%)',
                    border: '2px solid var(--status-panel-border, #e5e7eb)',
                    borderRadius: '1rem',
                    textAlign: 'center',
                    color: 'var(--status-text-muted, #6b7280)',
                    boxShadow: 'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.06))',
                }}>
                    <div style={{
                        fontSize: '4rem',
                        marginBottom: '1.5rem',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontWeight: '800',
                    }}>
                        ✓
                    </div>
                    <p style={{
                        fontSize: '1.25rem',
                        fontWeight: '700',
                        marginBottom: '0.5rem',
                        color: '#10b981',
                        letterSpacing: '-0.01em',
                    }}>
                        {incidents.length > 0 ? 'No incidents match your filters' : 'No incidents in the last 90 days'}
                    </p>
                    <p style={{ fontSize: '0.9375rem', color: 'var(--status-text-muted, #64748b)' }}>
                        {incidents.length > 0 ? 'Try adjusting your search or filters.' : 'All systems operational'}
                    </p>
                </div>
            ) : (
                <>
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        alignItems: 'center',
                        marginBottom: '1.25rem',
                    }}>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search incidents"
                            className="status-page-input"
                            style={{
                                minWidth: '200px',
                            }}
                        />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED')}
                            className="status-page-select"
                            style={{
                                minWidth: '160px',
                            }}
                        >
                            <option value="all">All statuses</option>
                            <option value="OPEN">Open</option>
                            <option value="ACKNOWLEDGED">Acknowledged</option>
                            <option value="RESOLVED">Resolved</option>
                        </select>
                        <select
                            value={serviceFilter}
                            onChange={(e) => setServiceFilter(e.target.value)}
                            className="status-page-select"
                            style={{
                                minWidth: '180px',
                            }}
                        >
                            <option value="all">All services</option>
                            {serviceOptions.map((service) => (
                                <option key={service} value={service}>{service}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {paginatedIncidents.map((incident) => {
                            const statusColor = getStatusColor(incident.status);
                            const isExpanded = expandedIncidents.has(incident.id);
                            const timelineEvents = incident.events || [];
                            const resolutionNote = getResolutionNote(timelineEvents);
                            const showPostmortemLink = Boolean(
                                showPostIncidentReview &&
                                incident.status === 'RESOLVED' &&
                                incident.postmortem?.status === 'PUBLISHED' &&
                                incident.postmortem?.isPublic !== false
                            );

                            return (
                                <div
                                    key={incident.id}
                                    className="status-incident-card"
                                    style={{
                                        padding: 'clamp(1.25rem, 4vw, 2rem)',
                                        background: 'var(--status-panel-bg, #ffffff)',
                                        border: `2px solid ${statusColor.border}30`,
                                        borderRadius: '1rem',
                                        transition: 'all 0.3s ease',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        boxShadow: 'var(--status-card-shadow, 0 1px 3px rgba(0, 0, 0, 0.05))',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.boxShadow = `0 12px 24px ${statusColor.border}25, 0 0 0 1px ${statusColor.border}50`;
                                        e.currentTarget.style.borderColor = `${statusColor.border}`;
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
                                        e.currentTarget.style.borderColor = `${statusColor.border}30`;
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }}
                                >
                                    {/* Status indicator bar */}
                                    <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: '5px',
                                        background: `linear-gradient(180deg, ${statusColor.border} 0%, ${statusColor.border}cc 100%)`,
                                        boxShadow: `0 0 8px ${statusColor.border}40`,
                                    }} />

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'clamp(0.75rem, 2vw, 1rem)', gap: '1rem', flexWrap: 'wrap' }}>
                                        <div style={{ flex: 1, minWidth: 0, paddingLeft: 'clamp(0.75rem, 2vw, 1rem)' }}>
                                            {privacy.showIncidentTitles && (
                                                <h3 style={{
                                                    fontSize: 'clamp(1.125rem, 3vw, 1.375rem)',
                                                    fontWeight: '800',
                                                    color: 'var(--status-text, #111827)',
                                                    marginBottom: '0.75rem',
                                                    letterSpacing: '-0.02em',
                                                    lineHeight: '1.3',
                                                    wordBreak: 'break-word',
                                                }}>
                                                    {incident.title}
                                                </h3>
                                            )}
                                            {!privacy.showIncidentTitles && (
                                                <h3 style={{
                                                    fontSize: 'clamp(1.125rem, 3vw, 1.375rem)',
                                                    fontWeight: '800',
                                                    color: 'var(--status-text, #111827)',
                                                    marginBottom: '0.75rem',
                                                    letterSpacing: '-0.02em',
                                                    lineHeight: '1.3',
                                                }}>
                                                    Incident
                                                </h3>
                                            )}
                                            {(privacy.showAffectedServices || privacy.showIncidentTimestamps) && (
                                                <div style={{
                                                    display: 'flex',
                                                    gap: '1rem',
                                                    fontSize: '0.875rem',
                                                    color: 'var(--status-text-muted, #6b7280)',
                                                    flexWrap: 'wrap',
                                                    alignItems: 'center',
                                                }}>
                                                    {privacy.showAffectedServices && (
                                                        <>
                                                            <div style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.5rem',
                                                                flexWrap: 'wrap',
                                                            }}>
                                                                <span style={{
                                                                    padding: '0.25rem 0.625rem',
                                                                    borderRadius: '0.375rem',
                                                                    background: '#f3f4f6',
                                                                    fontWeight: '600',
                                                                    color: 'var(--status-text, #374151)',
                                                                }}>
                                                                    {incident.service.name}
                                                                </span>
                                                                {privacy.showServiceRegions && getRegionList(incident.service?.region).map((region) => (
                                                                    <span
                                                                        key={`${incident.id}-${region}`}
                                                                        style={{
                                                                            padding: '0.2rem 0.55rem',
                                                                            borderRadius: '999px',
                                                                            background: 'var(--status-panel-muted-bg, #f8fafc)',
                                                                            border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                                                                            fontWeight: '600',
                                                                            color: 'var(--status-text-muted, #6b7280)',
                                                                            fontSize: '0.75rem',
                                                                        }}
                                                                    >
                                                                        {region}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            {privacy.showIncidentTimestamps && <span>|</span>}
                                                        </>
                                                    )}
                                                    {privacy.showIncidentTimestamps && (
                                                        <>
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                    <polyline points="12 6 12 12 16 14"></polyline>
                                                                </svg>
                                                                {formatDateTime(incident.createdAt, browserTimeZone, { format: 'datetime' })}
                                                            </span>
                                                            {incident.resolvedAt && (
                                                                <>
                                                                    <span>|</span>
                                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#10b981' }}>
                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                                        </svg>
                                                                        Resolved {formatDateTime(incident.resolvedAt, browserTimeZone, { format: 'short' })}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            {!privacy.showAffectedServices && privacy.showServiceRegions && getRegionList(incident.service?.region).length > 0 && (
                                                <div style={{
                                                    display: 'flex',
                                                    flexWrap: 'wrap',
                                                    gap: '0.5rem',
                                                    marginTop: '0.5rem',
                                                }}>
                                                    {getRegionList(incident.service?.region).map((region) => (
                                                        <span
                                                            key={`${incident.id}-${region}-solo`}
                                                            style={{
                                                                padding: '0.2rem 0.55rem',
                                                                borderRadius: '999px',
                                                                background: 'var(--status-panel-muted-bg, #f8fafc)',
                                                                border: '1px solid var(--status-panel-muted-border, #e2e8f0)',
                                                                fontWeight: '600',
                                                                color: 'var(--status-text-muted, #6b7280)',
                                                                fontSize: '0.75rem',
                                                            }}
                                                        >
                                                            {region}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                                            <span style={{
                                                padding: '0.5rem 1.125rem',
                                                borderRadius: '0.625rem',
                                                fontSize: '0.8125rem',
                                                fontWeight: '700',
                                                background: `linear-gradient(135deg, ${statusColor.bg} 0%, ${statusColor.bg}dd 100%)`,
                                                color: statusColor.text,
                                                border: `2px solid ${statusColor.border}60`,
                                                boxShadow: `0 2px 8px ${statusColor.border}30`,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                transition: 'all 0.2s ease',
                                            }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1.05)';
                                                    e.currentTarget.style.boxShadow = `0 4px 12px ${statusColor.border}50`;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'scale(1)';
                                                    e.currentTarget.style.boxShadow = `0 2px 8px ${statusColor.border}30`;
                                                }}
                                            >
                                                {statusColor.label}
                                            </span>
                                            {showPostmortemLink && (
                                                <a
                                                    href={`/status/postmortems/${incident.id}`}
                                                    style={{
                                                        padding: '0.45rem 0.9rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: '600',
                                                        color: 'var(--status-primary, #2563eb)',
                                                        border: '1px solid color-mix(in srgb, var(--status-primary, #2563eb) 40%, #ffffff)',
                                                        textDecoration: 'none',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                    }}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                        <polyline points="14 2 14 8 20 8"></polyline>
                                                    </svg>
                                                    Post-incident review
                                                </a>
                                            )}
                                            {privacy.showIncidentDetails && timelineEvents.length > 0 && (
                                                <button
                                                    onClick={() => toggleIncident(incident.id)}
                                                    className="status-page-button"
                                                    data-variant="primary"
                                                    aria-pressed={isExpanded}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        boxShadow: '0 6px 14px rgba(15, 23, 42, 0.16)',
                                                        fontSize: '0.8125rem',
                                                    }}
                                                >
                                                    {isExpanded ? (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polyline points="18 15 12 9 6 15"></polyline>
                                                            </svg>
                                                            Hide
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polyline points="6 9 12 15 18 9"></polyline>
                                                            </svg>
                                                            Show Updates
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {privacy.showIncidentDescriptions && incident.description && (
                                        <p style={{
                                            color: 'var(--status-text, #374151)',
                                            lineHeight: '1.7',
                                            marginBottom: '1rem',
                                            paddingLeft: '1rem',
                                            fontSize: '0.9375rem',
                                        }}>
                                            {incident.description}
                                        </p>
                                    )}

                                    {!privacy.showIncidentDetails && (
                                        <div style={{
                                            marginTop: '1.25rem',
                                            padding: '1rem',
                                            borderRadius: '0.75rem',
                                            border: '1px solid var(--status-panel-border, #e5e7eb)',
                                            background: 'var(--status-panel-muted-bg, #f8fafc)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.75rem',
                                            fontSize: '0.85rem',
                                            color: 'var(--status-text, #374151)',
                                        }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--status-text-muted, #6b7280)' }}>
                                                Milestones
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <span>Detected</span>
                                                    <span>{formatDateTime(incident.createdAt, browserTimeZone, { format: 'short' })}</span>
                                                </div>
                                                {incident.acknowledgedAt && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                        <span>Acknowledged</span>
                                                        <span>{formatDateTime(incident.acknowledgedAt, browserTimeZone, { format: 'short' })}</span>
                                                    </div>
                                                )}
                                                {incident.resolvedAt && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                        <span>Resolved</span>
                                                        <span>{formatDateTime(incident.resolvedAt, browserTimeZone, { format: 'short' })}</span>
                                                    </div>
                                                )}
                                            </div>
                                            {resolutionNote && (
                                                <div style={{
                                                    paddingTop: '0.75rem',
                                                    borderTop: '1px solid var(--status-panel-border, #e5e7eb)',
                                                    color: 'var(--status-text-muted, #475569)',
                                                }}>
                                                    <span style={{ fontWeight: '600', color: 'var(--status-text, #111827)' }}>Resolution:</span> {resolutionNote}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {privacy.showIncidentDetails && isExpanded && timelineEvents.length > 0 && (
                                        <div style={{
                                            marginTop: '1.5rem',
                                            paddingTop: '1.5rem',
                                            borderTop: '2px solid var(--status-panel-border, #e5e7eb)',
                                            paddingLeft: '1rem',
                                            background: 'linear-gradient(90deg, var(--status-panel-muted-bg, #f8fafc) 0%, transparent 100%)',
                                            borderRadius: '0.5rem',
                                            padding: '1.5rem 1rem',
                                        }}>
                                            <h4 style={{
                                                fontSize: '0.875rem',
                                                fontWeight: '700',
                                                marginBottom: '1.25rem',
                                                color: 'var(--status-text, #374151)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.1em',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.75rem',
                                            }}>
                                                <div style={{
                                                    width: '6px',
                                                    height: '6px',
                                                    borderRadius: '50%',
                                                    background: 'var(--status-primary, #3b82f6)',
                                                    boxShadow: '0 0 0 3px color-mix(in srgb, var(--status-primary, #3b82f6) 20%, transparent)',
                                                }}></div>
                                                Timeline Updates
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                {timelineEvents.map((event, index) => (
                                                    <div
                                                        key={event.id}
                                                        style={{
                                                            display: 'flex',
                                                            gap: '1rem',
                                                            paddingLeft: '1.5rem',
                                                            position: 'relative',
                                                        }}
                                                    >
                                                        {/* Timeline line */}
                                                        {index < timelineEvents.length - 1 && (
                                                            <div style={{
                                                                position: 'absolute',
                                                                left: '0.5rem',
                                                                top: '1.5rem',
                                                                bottom: '-1rem',
                                                                width: '2px',
                                                                background: 'linear-gradient(180deg, var(--status-primary, #3b82f6) 0%, #e5e7eb 100%)',
                                                            }} />
                                                        )}
                                                        {/* Timeline dot */}
                                                        <div style={{
                                                            width: '14px',
                                                            height: '14px',
                                                            borderRadius: '50%',
                                                            background: 'linear-gradient(135deg, var(--status-primary, #3b82f6) 0%, var(--status-primary-hover, #2563eb) 100%)',
                                                            border: '3px solid white',
                                                            boxShadow: '0 0 0 2px var(--status-primary, #3b82f6), 0 2px 12px color-mix(in srgb, var(--status-primary, #3b82f6) 35%, transparent)',
                                                            marginTop: '0.25rem',
                                                            flexShrink: 0,
                                                            zIndex: 1,
                                                            transition: 'all 0.2s ease',
                                                        }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.transform = 'scale(1.2)';
                                                                e.currentTarget.style.boxShadow = '0 0 0 3px var(--status-primary, #3b82f6), 0 4px 16px color-mix(in srgb, var(--status-primary, #3b82f6) 45%, transparent)';
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.transform = 'scale(1)';
                                                                e.currentTarget.style.boxShadow = '0 0 0 2px var(--status-primary, #3b82f6), 0 2px 12px color-mix(in srgb, var(--status-primary, #3b82f6) 35%, transparent)';
                                                            }}
                                                        />
                                                        <div style={{ flex: 1, paddingBottom: index < timelineEvents.length - 1 ? '1rem' : '0' }}>
                                                            <p style={{
                                                                color: 'var(--status-text, #111827)',
                                                                fontSize: '0.9375rem',
                                                                marginBottom: '0.5rem',
                                                                fontWeight: '500',
                                                                lineHeight: '1.6',
                                                            }}>
                                                                {event.message}
                                                            </p>
                                                            <span style={{
                                                                fontSize: '0.8125rem',
                                                                color: 'var(--status-text-subtle, #9ca3af)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.375rem',
                                                            }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                    <polyline points="12 6 12 12 16 14"></polyline>
                                                                </svg>
                                                                {formatDateTime(event.createdAt, browserTimeZone, { format: 'short' })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginTop: '2rem',
                            flexWrap: 'wrap',
                        }}>
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="status-page-button"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.875rem',
                                    fontWeight: '600',
                                    opacity: currentPage === 1 ? 0.6 : 1,
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="15 18 9 12 15 6"></polyline>
                                </svg>
                                Previous
                            </button>

                            <div style={{
                                display: 'flex',
                                gap: '0.375rem',
                                alignItems: 'center',
                            }}>
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                                    if (
                                        page === 1 ||
                                        page === totalPages ||
                                        (page >= currentPage - 1 && page <= currentPage + 1)
                                    ) {
                                        return (
                                            <button
                                                key={page}
                                                onClick={() => setCurrentPage(page)}
                                                className="status-page-button"
                                                data-active={currentPage === page}
                                                style={{
                                                    minWidth: '2.5rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '700',
                                                }}
                                            >
                                                {page}
                                            </button>
                                        );
                                    } else if (
                                        page === currentPage - 2 ||
                                        page === currentPage + 2
                                    ) {
                                        return (
                                            <span key={page} style={{ color: 'var(--status-text-subtle, #9ca3af)', padding: '0 0.25rem' }}>
                                                ...
                                            </span>
                                        );
                                    }
                                    return null;
                                })}
                            </div>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                className="status-page-button"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.875rem',
                                    fontWeight: '600',
                                    opacity: currentPage === totalPages ? 0.6 : 1,
                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                }}
                            >
                                Next
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
