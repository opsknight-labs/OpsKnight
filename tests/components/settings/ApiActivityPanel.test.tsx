import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const noFilters = { q: '', entity: '', actor: '', key: '', from: '', to: '', hasCursor: false };

describe('ApiActivityPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders audit events with action, entity type, actor, and timestamp', () => {
    render(<ApiActivityPanel activities={mockActivities} nextCursor={null} filters={noFilters} />);

    expect(screen.getByText('incident.create')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('INCIDENT')).toBeDefined();
    expect(screen.getByText('inc_prod_alert_1')).toBeDefined();
    expect(screen.getByText('Primary On-Call')).toBeDefined();
    expect(screen.getByText('10.0.1.42')).toBeDefined();

    expect(screen.getByText('runbook.execution_started')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('RUNBOOK')).toBeDefined();
    expect(screen.getByText('Machine Token')).toBeDefined();

    expect(screen.getByText('service.delete')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('SERVICE')).toBeDefined();
    expect(screen.getByText('Platform Admin')).toBeDefined();
  });

  it('renders details JSON when present or dash placeholder when null', () => {
    render(<ApiActivityPanel activities={mockActivities} nextCursor={null} filters={noFilters} />);

    expect(screen.getByText(/svc_auth/i)).toBeDefined();
    expect(screen.getByText(/exec_xyz_789/i)).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('submits filters to the server as URL params instead of filtering in the browser', () => {
    const { container } = render(
      <ApiActivityPanel
        activities={mockActivities}
        nextCursor={null}
        filters={{ ...noFilters, q: 'runbook', actor: 'oncall@opsknight.local' }}
      />
    );

    const form = container.querySelector('form') as HTMLFormElement;
    expect(form.method).toBe('get');
    expect((form.querySelector('input[name="tab"]') as HTMLInputElement).value).toBe('activity');
    expect((form.querySelector('input[name="q"]') as HTMLInputElement).value).toBe('runbook');
    expect((form.querySelector('input[name="actor"]') as HTMLInputElement).value).toBe(
      'oncall@opsknight.local'
    );
    // Rows come from the server response; nothing is hidden client-side.
    expect(screen.getByText('incident.create')).toBeDefined();
    expect(screen.getByText('service.delete')).toBeDefined();
  });

  it('links to older events with the cursor and keeps active filters', () => {
    render(
      <ApiActivityPanel
        activities={mockActivities}
        nextCursor="cursor-abc"
        filters={{ ...noFilters, q: 'incident', entity: 'INCIDENT' }}
      />
    );
    const older = screen.getByRole('link', { name: /older events/i }) as HTMLAnchorElement;
    const href = older.getAttribute('href') ?? '';
    expect(href).toContain('tab=activity');
    expect(href).toContain('cursor=cursor-abc');
    expect(href).toContain('q=incident');
    expect(href).toContain('entity=INCIDENT');
  });

  it('offers a way back to the newest events when paging', () => {
    render(
      <ApiActivityPanel
        activities={mockActivities}
        nextCursor={null}
        filters={{ ...noFilters, hasCursor: true }}
      />
    );
    expect(screen.getByRole('link', { name: /newest/i })).toBeDefined();
    expect(screen.queryByRole('link', { name: /older events/i })).toBeNull();
  });

  it('shows a filtered empty state with a reset link', () => {
    render(
      <ApiActivityPanel activities={[]} nextCursor={null} filters={{ ...noFilters, q: 'nonexistent' }} />
    );
    expect(screen.getByText('No matching API activity')).toBeDefined();
    expect(screen.getByRole('link', { name: /reset filters/i })).toBeDefined();
  });

  it('displays an unfiltered empty state when nothing has been recorded', () => {
    render(<ApiActivityPanel activities={[]} nextCursor={null} filters={noFilters} />);
    expect(screen.getByText('No API activity recorded yet')).toBeDefined();
  });

  it('states that it is audit history, not request traffic', () => {
    render(<ApiActivityPanel activities={mockActivities} nextCursor={null} filters={noFilters} />);
    expect(screen.getByText(/reads and rejected requests are not\s+recorded/i)).toBeDefined();
  });
});
