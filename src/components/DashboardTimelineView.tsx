'use client';

import { useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

type TimelineIncident = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  createdAt: Date;
  serviceName: string;
  assigneeName?: string;
};

type DashboardTimelineViewProps = {
  incidents: TimelineIncident[];
  services: Array<{ id: string; name: string }>;
};

export default function DashboardTimelineView({ incidents, services }: DashboardTimelineViewProps) {
  const { userTimeZone } = useTimezone();
  const [selectedService, setSelectedService] = useState<string>('all');
  const [zoomLevel, setZoomLevel] = useState<'day' | 'week' | 'month'>('week');

  // Group incidents by time period
  const _now = new Date();
  const getTimeKey = (date: Date) => {
    const d = new Date(date);
    if (zoomLevel === 'day') {
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    } else if (zoomLevel === 'week') {
      const dayOfWeek = d.getDay();
      d.setDate(d.getDate() - dayOfWeek);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    } else {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
  };

  const filteredIncidents =
    selectedService === 'all'
      ? incidents
      : incidents.filter(i => {
          const service = services.find(s => s.name === i.serviceName);
          return service?.id === selectedService;
        });

  const grouped = filteredIncidents.reduce(
    (acc, incident) => {
      const key = getTimeKey(incident.createdAt);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(incident);
      return acc;
    },
    {} as Record<string, TimelineIncident[]>
  );

  const sortedGroups = Object.entries(grouped)
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .reverse();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN':
        return '#dc2626';
      case 'ACKNOWLEDGED':
        return '#2563eb';
      case 'RESOLVED':
        return '#16a34a';
      default:
        return '#6b7280';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    if (urgency === 'HIGH') return '#ef5350';
    if (urgency === 'MEDIUM') return '#f59e0b';
    if (urgency === 'LOW') return '#16a34a';
    return '#6b7280';
  };

  const formatTimeLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (zoomLevel === 'day') {
      return formatDateTime(date, userTimeZone, { format: 'date' });
    } else if (zoomLevel === 'week') {
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 6);
      return `${formatDateTime(date, userTimeZone, { format: 'short' }).split(',')[0]} - ${formatDateTime(endDate, userTimeZone, { format: 'short' }).split(',')[0]}`;
    } else {
      const formatter = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: userTimeZone,
      });
      return formatter.format(date);
    }
  };

  return (
    <div className="glass-panel" style={{ background: 'white', padding: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Incident Timeline</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedService}
            onChange={e => setSelectedService(e.target.value)}
            style={{
              padding: '0.4rem 0.8rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.85rem',
              background: 'white',
            }}
          >
            <option value="all">All Services</option>
            {services.map(service => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
          <div
            style={{
              display: 'flex',
              gap: '0.25rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            {(['day', 'week', 'month'] as const).map(level => (
              <button
                key={level}
                onClick={() => setZoomLevel(level)}
                style={{
                  padding: '0.4rem 0.8rem',
                  border: 'none',
                  background: zoomLevel === level ? 'var(--primary-color)' : 'white',
                  color: zoomLevel === level ? 'white' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  textTransform: 'capitalize',
                }}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
        {sortedGroups.length > 0 ? (
          <div style={{ position: 'relative', paddingLeft: '2rem' }}>
            {sortedGroups.map(([timeKey, groupIncidents], index) => (
              <div key={timeKey} style={{ marginBottom: '2rem', position: 'relative' }}>
                {/* Timeline line */}
                {index < sortedGroups.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '0.5rem',
                      top: '2rem',
                      bottom: '-2rem',
                      width: '2px',
                      background: '#e5e7eb',
                    }}
                  />
                )}
                {/* Time marker */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '1rem',
                    height: '1rem',
                    borderRadius: '50%',
                    background: 'var(--primary-color)',
                    border: '2px solid white',
                    zIndex: 2,
                  }}
                />
                {/* Time label */}
                <div style={{ marginLeft: '1.5rem', marginBottom: '0.5rem' }}>
                  <div
                    style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}
                  >
                    {formatTimeLabel(timeKey)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {groupIncidents.length} incident{groupIncidents.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {/* Incidents */}
                <div
                  style={{
                    marginLeft: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  {groupIncidents.map(incident => (
                    <div
                      key={incident.id}
                      style={{
                        padding: '0.75rem',
                        background: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: getStatusColor(incident.status),
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            marginBottom: '0.25rem',
                          }}
                        >
                          {incident.title}
                        </div>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            gap: '0.75rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span>{incident.serviceName}</span>
                          {incident.assigneeName && <span>• {incident.assigneeName}</span>}
                          <span>• {incident.status}</span>
                          <span
                            style={{
                              color: getUrgencyColor(incident.urgency),
                              fontWeight: '600',
                            }}
                          >
                            {incident.urgency} urgency
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {formatDateTime(incident.createdAt, userTimeZone, { format: 'time' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
            }}
          >
            No incidents in this period
          </div>
        )}
      </div>
    </div>
  );
}
