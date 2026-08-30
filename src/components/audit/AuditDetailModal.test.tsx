import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AuditDetailModal, { getEntityHref } from './AuditDetailModal';

describe('AuditDetailModal', () => {
  const sampleLog = {
    id: 'aud_12345',
    createdAt: '2026-08-30T17:00:00.000Z',
    action: 'INCIDENT_CREATE',
    entityType: 'INCIDENT',
    entityId: 'inc_9999',
    actorName: 'Dushyant',
    actorEmail: 'admin@opsknight.com',
    actor: {
      id: 'usr_1',
      name: 'Dushyant',
      email: 'admin@opsknight.com',
      avatarUrl: null,
    },
    details: '{"ip":"127.0.0.1","title":"API Outage"}',
  };

  it('correctly builds entity hrefs', () => {
    expect(getEntityHref('INCIDENT', 'inc_123')).toBe('/incidents/inc_123');
    expect(getEntityHref('USER', 'usr_456')).toBe('/users/usr_456');
    expect(getEntityHref('TEAM', 'tm_789')).toBe('/teams/tm_789');
    expect(getEntityHref('SERVICE', 'svc_101')).toBe('/services/svc_101');
    expect(getEntityHref('POLICY', 'pol_202')).toBe('/policies/pol_202');
    expect(getEntityHref('SCHEDULE', 'sch_303')).toBe('/schedules/sch_303');
    expect(getEntityHref('UNKNOWN', 'xyz')).toBeNull();
  });

  it('renders modal content when open', () => {
    const onClose = vi.fn();
    render(<AuditDetailModal log={sampleLog} isOpen={true} onClose={onClose} />);

    expect(screen.getByText('Audit Record Details')).toBeInTheDocument();
    expect(screen.getByText('INCIDENT_CREATE')).toBeInTheDocument();
    expect(screen.getByText('Dushyant')).toBeInTheDocument();
    expect(screen.getByText('inc_9999')).toBeInTheDocument();
    expect(screen.getByText(/API Outage/)).toBeInTheDocument();
  });
});
