'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { bulkAcknowledge, bulkResolve } from '@/app/(app)/incidents/bulk-actions';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

type Incident = {
  id: string;
  title: string;
  status: string;
  urgency?: string;
  service: { name: string };
  assignee: { name: string } | null;
  team?: { name: string } | null;
  createdAt: Date;
};

type IncidentTableMobileProps = {
  incidents: Incident[];
  sortBy?: string;
  sortOrder?: string;
};

export default function IncidentTableMobile({
  incidents,
  sortBy = 'createdAt',
  sortOrder = 'desc',
}: IncidentTableMobileProps) {
  const { userTimeZone } = useTimezone();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const _handleSortClick = (newSortBy: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (sortBy === newSortBy && sortOrder === 'asc') {
      params.set('sortBy', newSortBy);
      params.set('sortOrder', 'desc');
    } else if (sortBy === newSortBy && sortOrder === 'desc') {
      params.delete('sortBy');
      params.delete('sortOrder');
    } else {
      params.set('sortBy', newSortBy);
      params.set('sortOrder', 'asc');
    }
    params.delete('page');
    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname || '/';
    router.push(newUrl);
  };

  const toggleIncident = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const _toggleAll = () => {
    if (selectedIds.size === incidents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(incidents.map(i => i.id)));
    }
  };

  const handleBulkAcknowledge = () => {
    startTransition(async () => {
      const result = await bulkAcknowledge(Array.from(selectedIds));
      if (result.success) {
        setSelectedIds(new Set());
      } else {
        alert(result.error || 'Failed to acknowledge incidents');
      }
    });
  };

  const handleBulkResolve = () => {
    startTransition(async () => {
      const result = await bulkResolve(Array.from(selectedIds));
      if (result.success) {
        setSelectedIds(new Set());
      } else {
        alert(result.error || 'Failed to resolve incidents');
      }
    });
  };

  return (
    <div className="glass-panel" style={{ background: 'white', overflow: 'hidden' }}>
      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--gradient-primary)',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontWeight: '600' }}>
            {selectedIds.size} incident{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleBulkAcknowledge}
              disabled={isPending}
              style={{
                padding: '0.5rem 1rem',
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '6px',
                color: 'white',
                fontWeight: '500',
                cursor: isPending ? 'not-allowed' : 'pointer',
                opacity: isPending ? 0.6 : 1,
                fontSize: '0.85rem',
              }}
            >
              ✓ Acknowledge
            </button>
            <button
              onClick={handleBulkResolve}
              disabled={isPending}
              style={{
                padding: '0.5rem 1rem',
                background: 'rgba(255,255,255,0.9)',
                border: 'none',
                borderRadius: '6px',
                color: 'var(--primary-color)',
                fontWeight: '600',
                cursor: isPending ? 'not-allowed' : 'pointer',
                opacity: isPending ? 0.6 : 1,
                fontSize: '0.85rem',
              }}
            >
              ✓ Resolve
            </button>
          </div>
        </div>
      )}

      {/* Mobile Card View */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' }}>
        {incidents.map(incident => (
          <div
            key={incident.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1rem',
              background: 'white',
              boxShadow: 'var(--shadow-sm)',
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
              <div style={{ flex: 1 }}>
                <Link
                  href={`/incidents/${incident.id}`}
                  style={{
                    fontWeight: '600',
                    color: 'var(--primary-color)',
                    textDecoration: 'none',
                    fontSize: '0.95rem',
                    display: 'block',
                    marginBottom: '0.25rem',
                  }}
                >
                  {incident.title}
                </Link>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  #{incident.id.slice(-5).toUpperCase()}
                </div>
              </div>
              <input
                type="checkbox"
                checked={selectedIds.has(incident.id)}
                onChange={() => toggleIncident(incident.id)}
                style={{ cursor: 'pointer', width: '18px', height: '18px', marginLeft: '0.5rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
              >
                <span
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    background:
                      incident.status === 'RESOLVED'
                        ? '#e6f4ea'
                        : incident.status === 'ACKNOWLEDGED'
                          ? '#fff8e1'
                          : '#fce8e8',
                    color:
                      incident.status === 'RESOLVED'
                        ? 'var(--success)'
                        : incident.status === 'ACKNOWLEDGED'
                          ? 'var(--warning)'
                          : 'var(--danger)',
                  }}
                >
                  {incident.status}
                </span>
                {incident.urgency && (
                  <span
                    style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      background:
                        incident.urgency === 'HIGH'
                          ? '#fee2e2'
                          : incident.urgency === 'MEDIUM'
                            ? '#fef3c7'
                            : '#dcfce7',
                      color:
                        incident.urgency === 'HIGH'
                          ? '#b91c1c'
                          : incident.urgency === 'MEDIUM'
                            ? '#92400e'
                            : '#166534',
                      display: 'inline-block',
                    }}
                  >
                    {incident.urgency}
                  </span>
                )}
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <div style={{ marginBottom: '0.25rem' }}>
                  <strong>Service:</strong> {incident.service.name}
                </div>
                <div style={{ marginBottom: '0.25rem' }}>
                  <strong>Assignee:</strong>{' '}
                  {incident.assignee?.name || incident.team?.name || 'Unassigned'}
                </div>
                <div>
                  <strong>Created:</strong>{' '}
                  {formatDateTime(incident.createdAt, userTimeZone, { format: 'datetime' })}
                </div>
              </div>
            </div>
          </div>
        ))}

        {incidents.length === 0 && (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
            <div>
              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  marginBottom: '0.5rem',
                }}
              >
                No incidents found
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                No incidents match your current filters. Try adjusting your search criteria.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
