import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApiActivityPanel, { type ApiAuditLogItem } from '@/components/settings/ApiActivityPanel';

const mockActivities: ApiAuditLogItem[] = [
  {
    id: 'audit-1',
    action: 'incident.create',
    entityType: 'INCIDENT',
    entityId: 'inc_prod_alert_1',
    actorEmail: 'oncall@opsknight.local',
    actorName: 'Primary On-Call',
    createdAt: '2026-10-14 10:00:00',
    details: { serviceId: 'svc_auth', priority: 'P1' },
    ip: '10.0.1.42',
  },
  {
    id: 'audit-2',
    action: 'runbook.execution_started',
    entityType: 'RUNBOOK',
    entityId: 'rb_restart_pods',
    actorEmail: null,
    actorName: null,
    createdAt: '2026-10-14 10:05:00',
    details: { executionId: 'exec_xyz_789' },
    ip: '10.0.2.15',
  },
  {
    id: 'audit-3',
    action: 'service.delete',
    entityType: 'SERVICE',
    entityId: 'svc_deprecated',
    actorEmail: 'admin@opsknight.local',
    actorName: 'Platform Admin',
    createdAt: '2026-10-14 10:15:00',
    details: null,
    ip: '192.168.1.1',
  },
];

describe('ApiActivityPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders audit events with action, entity type, actor, and timestamp', () => {
    render(<ApiActivityPanel activities={mockActivities} />);

    expect(screen.getByText('incident.create')).toBeDefined();
    expect(screen.getByText('INCIDENT')).toBeDefined();
    expect(screen.getByText('inc_prod_alert_1')).toBeDefined();
    expect(screen.getByText('Primary On-Call')).toBeDefined();
    expect(screen.getByText('10.0.1.42')).toBeDefined();

    expect(screen.getByText('runbook.execution_started')).toBeDefined();
    expect(screen.getByText('RUNBOOK')).toBeDefined();
    expect(screen.getByText('Machine Token')).toBeDefined();

    expect(screen.getByText('service.delete')).toBeDefined();
    expect(screen.getByText('SERVICE')).toBeDefined();
    expect(screen.getByText('Platform Admin')).toBeDefined();
  });

  it('renders details JSON when present or dash placeholder when null', () => {
    render(<ApiActivityPanel activities={mockActivities} />);

    expect(screen.getByText(/svc_auth/i)).toBeDefined();
    expect(screen.getByText(/exec_xyz_789/i)).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('filters audit records by search keyword on action or actor', () => {
    render(<ApiActivityPanel activities={mockActivities} />);

    const searchInput = screen.getByPlaceholderText(/search activity by action, entity id, or actor/i);
    fireEvent.change(searchInput, { target: { value: 'runbook' } });

    expect(screen.getByText('runbook.execution_started')).toBeDefined();
    expect(screen.queryByText('incident.create')).toBeNull();
    expect(screen.queryByText('service.delete')).toBeNull();
  });

  it('filters audit records by actor email or name', () => {
    render(<ApiActivityPanel activities={mockActivities} />);

    const searchInput = screen.getByPlaceholderText(/search activity by action, entity id, or actor/i);
    fireEvent.change(searchInput, { target: { value: 'oncall@opsknight.local' } });

    expect(screen.getByText('incident.create')).toBeDefined();
    expect(screen.queryByText('runbook.execution_started')).toBeNull();
  });

  it('displays empty state when no activity matches search criteria and allows resetting filters', () => {
    render(<ApiActivityPanel activities={mockActivities} />);

    const searchInput = screen.getByPlaceholderText(/search activity by action, entity id, or actor/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent_event' } });

    expect(screen.getByText('No matching API activity')).toBeDefined();

    const resetButton = screen.getByRole('button', { name: /reset filters/i });
    fireEvent.click(resetButton);

    expect(screen.getByText('incident.create')).toBeDefined();
    expect(screen.getByText('runbook.execution_started')).toBeDefined();
    expect(screen.getByText('service.delete')).toBeDefined();
  });

  it('displays empty state when activities array is empty', () => {
    render(<ApiActivityPanel activities={[]} />);

    expect(screen.getByText('No recent API activity logged')).toBeDefined();
    expect(screen.getByText(/tamper-evident audit records will stream here/i)).toBeDefined();
  });
});
