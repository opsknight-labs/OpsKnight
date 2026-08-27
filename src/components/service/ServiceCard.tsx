'use client';

import { useRouter } from 'next/navigation';
import { useState, memo, useMemo } from 'react';
import StatusBadge from '../incident/StatusBadge';
import { getServiceDynamicStatus } from '@/lib/service-status';

type ServiceCardProps = {
  service: {
    id: string;
    name: string;
    description: string | null;
    region?: string | null;
    status: string;
    team: { id: string; name: string } | null;
    policy: { id: string; name: string } | null;
    _count?: { incidents: number };
    incidents?: Array<{ id: string; urgency: string }>;
    openIncidentCount?: number;
    hasCritical?: boolean;
    dynamicStatus?: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';
  };
  compact?: boolean;
};

function ServiceCard({ service, compact = false }: ServiceCardProps) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  // Memoize computed values to prevent recalculation on every render
  const { openIncidents, hasCritical, status, openIncidentCount } = useMemo(() => {
    const incidents = service.incidents || [];
    const count =
      typeof service.openIncidentCount === 'number' ? service.openIncidentCount : incidents.length;
    const critical =
      typeof service.hasCritical === 'boolean'
        ? service.hasCritical
        : incidents.some(i => i.urgency === 'HIGH');
    const calculatedStatus =
      service.dynamicStatus ||
      getServiceDynamicStatus({ activeIncidentCount: count, hasCritical: critical });
    return {
      openIncidents: incidents,
      hasCritical: critical,
      openIncidentCount: count,
      status: calculatedStatus,
    };
  }, [service.incidents, service.dynamicStatus, service.openIncidentCount, service.hasCritical]);

  const displayStatus = status as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [compactHovered, setCompactHovered] = useState(false);

  if (compact) {
    return (
      <div
        onClick={() => router.push(`/services/${service.id}`)}
        onMouseEnter={() => setCompactHovered(true)}
        onMouseLeave={() => setCompactHovered(false)}
        style={{
          display: 'block',
          padding: '1rem',
          background: '#fff',
          border: `1px solid ${compactHovered ? 'var(--primary-color)' : 'var(--border)'}`,
          borderRadius: '0px',
          cursor: 'pointer',
          transition: 'all 0.15s',
          boxShadow: compactHovered
            ? '0 4px 12px rgba(211, 47, 47, 0.15)'
            : '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '0.5rem',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.25rem',
              }}
            >
              <StatusBadge status={displayStatus} size="sm" showDot />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {service.name}
            </div>
            {service.description && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {service.description.length > 60
                  ? service.description.substring(0, 60) + '...'
                  : service.description}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginTop: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <span>{service.team?.name || 'Unassigned'}</span>
          {service.region && (
            <>
              <span>ƒ?›</span>
              <span>{service.region}</span>
            </>
          )}
          {openIncidentCount > 0 && (
            <>
              <span>•</span>
              <span style={{ color: hasCritical ? 'var(--danger)' : 'var(--warning)' }}>
                {openIncidentCount} active incident{openIncidentCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Get status color for background
  const statusColors: Record<
    string,
    { bg: string; border: string; hoverBorder: string; hoverShadow: string }
  > = {
    OPERATIONAL: {
      bg: 'linear-gradient(180deg, rgba(34,197,94,0.03) 0%, #ffffff 60%)',
      border: 'rgba(34,197,94,0.15)',
      hoverBorder: 'var(--primary-color)',
      hoverShadow: '0 8px 20px rgba(211, 47, 47, 0.12)',
    },
    DEGRADED: {
      bg: 'linear-gradient(180deg, rgba(245,158,11,0.03) 0%, #ffffff 60%)',
      border: 'rgba(245,158,11,0.15)',
      hoverBorder: 'var(--warning)',
      hoverShadow: '0 8px 20px rgba(245, 158, 11, 0.15)',
    },
    CRITICAL: {
      bg: 'linear-gradient(180deg, rgba(239,68,68,0.05) 0%, #ffffff 60%)',
      border: 'rgba(239,68,68,0.25)',
      hoverBorder: 'var(--danger)',
      hoverShadow: '0 8px 20px rgba(239, 68, 68, 0.2)',
    },
  };
  const statusColor = statusColors[status] || statusColors['OPERATIONAL'];

  const handleCardClick = () => {
    router.push(`/services/${service.id}`);
  };

  const handlePolicyLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/policies/${service.policy!.id}`);
  };

  return (
    <div
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'block',
        padding: '1.5rem',
        background: statusColor.bg,
        border: `1px solid ${isHovered ? statusColor.hoverBorder : statusColor.border}`,
        borderRadius: '0px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: isHovered ? statusColor.hoverShadow : '0 2px 6px rgba(0,0,0,0.06)',
        position: 'relative',
        overflow: 'hidden',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* Status indicator line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background:
            status === 'CRITICAL'
              ? 'var(--danger)'
              : status === 'DEGRADED'
                ? 'var(--warning)'
                : 'var(--success)',
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={displayStatus} size="md" showDot />
            {status === 'CRITICAL' && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.5rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--danger)',
                  borderRadius: '4px',
                  fontWeight: '600',
                }}
              >
                Action Required
              </span>
            )}
          </div>
          <h3
            style={{
              fontWeight: 700,
              fontSize: '1.25rem',
              color: 'var(--text-primary)',
              marginBottom: '0.5rem',
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
            }}
          >
            {service.name}
          </h3>
          {service.description && (
            <p
              style={{
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginBottom: '0.75rem',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {service.description}
            </p>
          )}
          {service.region && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.3rem 0.65rem',
                borderRadius: '999px',
                border: '1px solid rgba(15, 23, 42, 0.1)',
                background: 'rgba(15, 23, 42, 0.03)',
                color: 'var(--text-secondary)',
                fontSize: '0.8rem',
                fontWeight: '600',
                marginBottom: '0.75rem',
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
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              {service.region}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.25rem',
              fontWeight: '600',
            }}
          >
            Team
          </div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
            {service.team?.name || 'Unassigned'}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.25rem',
              fontWeight: '600',
            }}
          >
            Incidents
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {openIncidentCount > 0 ? (
              <span
                style={{
                  color: hasCritical ? 'var(--danger)' : 'var(--warning)',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                }}
              >
                {openIncidentCount} active
              </span>
            ) : (
              <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.95rem' }}>
                All clear
              </span>
            )}
            {service._count && service._count.incidents > 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {service._count.incidents} total
              </span>
            )}
          </div>
        </div>
        {service.policy && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div
              style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.25rem',
                fontWeight: '600',
              }}
            >
              Escalation Policy
            </div>
            <button
              onClick={handlePolicyLinkClick}
              style={{
                color: 'var(--primary-color)',
                fontWeight: 600,
                fontSize: '0.9rem',
                textDecoration: 'none',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--primary-hover)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--primary-color)';
              }}
            >
              {service.policy.name}
            </button>
          </div>
        )}
      </div>

      {/* Arrow indicator */}
      <div
        data-arrow
        style={{
          position: 'absolute',
          bottom: '1rem',
          right: '1rem',
          opacity: isHovered ? 0.6 : 0.3,
          transition: 'opacity 0.2s, transform 0.2s',
          pointerEvents: 'none',
          transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            color: 'var(--text-muted)',
          }}
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>
    </div>
  );
}

// Memoize ServiceCard with custom comparison to prevent re-renders when props haven't changed
export default memo(ServiceCard, (prevProps, nextProps) => {
  // Custom comparison function for better performance
  const prevIncidents = prevProps.service.incidents || [];
  const nextIncidents = nextProps.service.incidents || [];

  // Compare incidents array length and IDs
  const incidentsEqual =
    prevIncidents.length === nextIncidents.length &&
    prevIncidents.every(
      (inc, i) => inc.id === nextIncidents[i]?.id && inc.urgency === nextIncidents[i]?.urgency
    );

  return (
    prevProps.service.id === nextProps.service.id &&
    prevProps.service.name === nextProps.service.name &&
    prevProps.service.description === nextProps.service.description &&
    prevProps.service.region === nextProps.service.region &&
    prevProps.service.status === nextProps.service.status &&
    prevProps.service.dynamicStatus === nextProps.service.dynamicStatus &&
    prevProps.service.team?.id === nextProps.service.team?.id &&
    prevProps.service.team?.name === nextProps.service.team?.name &&
    prevProps.service.policy?.id === nextProps.service.policy?.id &&
    prevProps.service.policy?.name === nextProps.service.policy?.name &&
    prevProps.service._count?.incidents === nextProps.service._count?.incidents &&
    incidentsEqual &&
    prevProps.compact === nextProps.compact
  );
});
