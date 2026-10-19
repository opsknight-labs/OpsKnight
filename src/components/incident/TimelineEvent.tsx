'use client';

import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { isRunbookEventType, runbookEventDisplay } from '@/lib/incidents/response-presentation';

type TimelineEventProps = {
  message: string;
  createdAt: Date;
  type?: string | null;
  isFirst?: boolean;
  isLast?: boolean;
};

export default function TimelineEvent({
  message,
  createdAt,
  type,
  isLast = false,
}: TimelineEventProps) {
  const { userTimeZone } = useTimezone();
  const runbookLabel = isRunbookEventType(type) ? runbookEventDisplay(type, message).label : null;
  return (
    <div
      style={{ position: 'relative', paddingLeft: '1.5rem', paddingBottom: isLast ? 0 : '1.5rem' }}
    >
      {/* Timeline line */}
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: '0.5rem',
            top: '1rem',
            bottom: '-1.5rem',
            width: '2px',
            background: 'var(--border)',
          }}
        />
      )}

      {/* Timeline dot */}
      <div
        style={{
          position: 'absolute',
          left: '0.25rem',
          top: '0.25rem',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: '#fff',
          border: '2px solid var(--primary-color)',
          boxShadow: '0 0 0 4px #f1f5f9',
          zIndex: 1,
        }}
      />

      {/* Event content */}
      <div style={{ marginTop: '-0.25rem' }}>
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {formatDateTime(createdAt, userTimeZone, { format: 'time' })}
          <span style={{ marginLeft: '0.5rem', opacity: 0.6 }}>
            {formatDateTime(createdAt, userTimeZone, { format: 'short' })}
          </span>
          {runbookLabel && (
            <span style={{ marginLeft: '0.5rem' }} data-event-type={type}>
              · {runbookLabel}
            </span>
          )}
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            padding: '0.875rem 1rem',
            boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
