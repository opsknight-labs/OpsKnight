'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import SLAIndicator from './SLAIndicator';
import SLABreachWarningBadge from './SLABreachWarningBadge';
import EscalationStatusBadge from './EscalationStatusBadge';
import { Incident, Service } from '@prisma/client';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

type IncidentCardProps = {
  incident: Incident & {
    service: Service;
    assignee: { id: string; name: string; email: string } | null;
  };
  showSLA?: boolean;
  showEscalation?: boolean;
  compact?: boolean;
};

function IncidentCard({
  incident,
  showSLA = false,
  showEscalation = false,
  compact = false,
}: IncidentCardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const incidentStatus = incident.status as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const handleServiceClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    router.push(`/services/${incident.service.id}`);
  };
  if (compact) {
    return (
      <Link
        href={`/incidents/${incident.id}`}
        style={{
          display: 'block',
          padding: '1rem',
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: '0px',
          textDecoration: 'none',
          transition: 'all 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--primary-color)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(211, 47, 47, 0.15)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
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
                flexWrap: 'wrap',
              }}
            >
              <StatusBadge status={incidentStatus} size="sm" showDot />
              <PriorityBadge priority={incident.priority} size="sm" />
              {showEscalation && (
                <EscalationStatusBadge
                  status={incident.escalationStatus}
                  currentStep={incident.currentEscalationStep}
                  nextEscalationAt={incident.nextEscalationAt}
                  size="sm"
                />
              )}
              <SLABreachWarningBadge incident={incident} service={incident.service} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {incident.title}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {incident.service.name} • #{incident.id.slice(-5).toUpperCase()}
            </div>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              textAlign: 'right',
              marginLeft: '1rem',
            }}
          >
            {formatDateTime(incident.createdAt, userTimeZone, { format: 'time' })}
          </div>
        </div>
        {showSLA && (
          <div
            style={{
              marginTop: '0.75rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <SLAIndicator incident={incident} service={incident.service} showDetails={false} />
          </div>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={`/incidents/${incident.id}`}
      style={{
        display: 'block',
        padding: '1.25rem',
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        border: '1px solid var(--border)',
        borderRadius: '0px',
        textDecoration: 'none',
        transition: 'all 0.15s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--primary-color)';
        e.currentTarget.style.boxShadow = '0 8px 16px rgba(211, 47, 47, 0.12)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
      }}
    >
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
              marginBottom: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={incidentStatus} size="md" showDot />
            <PriorityBadge priority={incident.priority} size="md" />
            {showEscalation && (
              <EscalationStatusBadge
                status={incident.escalationStatus}
                currentStep={incident.currentEscalationStep}
                nextEscalationAt={incident.nextEscalationAt}
              />
            )}
            <SLABreachWarningBadge incident={incident} service={incident.service} />
          </div>
          <h3
            style={{
              fontWeight: 700,
              fontSize: '1.1rem',
              color: 'var(--text-primary)',
              marginBottom: '0.25rem',
              lineHeight: 1.3,
            }}
          >
            {incident.title}
          </h3>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            <span
              style={{
                color: 'var(--primary-color)',
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
              onClick={handleServiceClick}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleServiceClick(e);
                }
              }}
              role="link"
              tabIndex={0}
            >
              {incident.service.name}
            </span>
            {' • '}#{incident.id.slice(-5).toUpperCase()}
          </div>
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textAlign: 'right',
            marginLeft: '1rem',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            {formatDateTime(incident.createdAt, userTimeZone, { format: 'short' })}
          </div>
          <div>{formatDateTime(incident.createdAt, userTimeZone, { format: 'time' })}</div>
        </div>
      </div>

      {incident.assignee && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            background: '#f9fafb',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            marginBottom: '0.75rem',
            width: 'fit-content',
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'var(--primary-color)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}
          >
            {incident.assignee.name.charAt(0)}
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
            {incident.assignee.name}
          </span>
        </div>
      )}

      {showSLA && (
        <div
          style={{
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border)',
          }}
        >
          <SLAIndicator incident={incident} service={incident.service} showDetails={false} />
        </div>
      )}
    </Link>
  );
}

// Memoize IncidentCard to prevent unnecessary re-renders in lists
export default memo(IncidentCard, (prevProps, nextProps) => {
  // Custom comparison for better performance
  return (
    prevProps.incident.id === nextProps.incident.id &&
    prevProps.incident.status === nextProps.incident.status &&
    prevProps.incident.urgency === nextProps.incident.urgency &&
    prevProps.incident.priority === nextProps.incident.priority &&
    prevProps.incident.title === nextProps.incident.title &&
    prevProps.incident.assignee?.id === nextProps.incident.assignee?.id &&
    prevProps.incident.service.id === nextProps.incident.service.id &&
    prevProps.showSLA === nextProps.showSLA &&
    prevProps.showEscalation === nextProps.showEscalation &&
    prevProps.compact === nextProps.compact
  );
});
