import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SystemHealthCenter from '@/components/settings/SystemHealthCenter';
import type { AdminHealthReport } from '@/lib/admin-health';

vi.mock('@/app/(app)/settings/system/actions', () => ({
  refreshAdminHealthAction: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockReport: AdminHealthReport = {
  generatedAt: '2026-09-02T12:00:00.000Z',
  overall: 'degraded',
  checks: [
    {
      id: 'database',
      label: 'PostgreSQL Database',
      category: 'database',
      status: 'healthy',
      summary: 'PostgreSQL responded in 12 ms.',
      details: ['Connection check passed.'],
      action: { label: 'Monitoring guide', href: 'https://opsknight.com/docs/monitoring' },
    },
    {
      id: 'database-capacity',
      label: 'Database capacity',
      category: 'database',
      status: 'healthy',
      summary: '15 of 100 connections in use (15%).',
      details: ['Active connections: 4', 'Database size: 45.2 MiB'],
    },
    {
      id: 'migrations',
      label: 'Database migrations',
      category: 'database',
      status: 'healthy',
      summary: 'Packaged migrations match the database history.',
      details: ['Applied records: 28'],
    },
    {
      id: 'scheduler',
      label: 'Scheduler and workers',
      category: 'workers',
      status: 'degraded',
      summary: 'No recent successful scheduler heartbeat.',
      details: ['Last run: 15 minutes ago'],
      action: { label: 'Maintenance guide', href: 'https://opsknight.com/docs/maintenance' },
    },
    {
      id: 'jobs',
      label: 'Background jobs',
      category: 'workers',
      status: 'unhealthy',
      summary: '12 pending, 1 failed.',
      details: ['Processing longer than 10 minutes: 1'],
    },
    {
      id: 'sla-performance',
      label: 'SLA query performance',
      category: 'workers',
      status: 'healthy',
      summary: '142 queries in 24 hours; p95 180 ms.',
      details: ['Average: 45 ms', 'p50: 32 ms'],
    },
    {
      id: 'escalations',
      label: 'Escalation backlog',
      category: 'workers',
      status: 'healthy',
      summary: 'No escalation steps are overdue.',
      details: ['Stale processing locks: 0'],
    },
    {
      id: 'paging-configuration',
      label: 'Paging configuration coverage',
      category: 'alerting',
      status: 'healthy',
      summary: 'All 8 services have an escalation policy with at least one step.',
      details: ['Without an escalation policy: none'],
    },
    {
      id: 'notifications',
      label: 'Notification providers',
      category: 'alerting',
      status: 'healthy',
      summary: '3 enabled provider(s); 0 failed delivery record(s).',
      details: ['Pending longer than 5 minutes: 0'],
    },
    {
      id: 'integrations',
      label: 'Inbound integrations',
      category: 'alerting',
      status: 'healthy',
      summary: '5 enabled integration(s); 0% in-process error rate.',
      details: ['Integrations with recorded errors: none'],
    },
    {
      id: 'public-url',
      label: 'Public URL',
      category: 'security',
      status: 'healthy',
      summary: 'Canonical origin: https://ops.example.com',
      details: ['Database setting: https://ops.example.com'],
    },
    {
      id: 'encryption',
      label: 'Encryption configuration',
      category: 'security',
      status: 'healthy',
      summary: 'A valid 32-byte hexadecimal encryption key is configured.',
      details: ['Key material and fingerprints are never displayed.'],
    },
    {
      id: 'version',
      label: 'Version and upgrades',
      category: 'platform',
      status: 'healthy',
      summary: 'Running 1.4.0; no newer stable release was found.',
      details: ['Release discovery uses public GitHub Releases API.'],
    },
  ],
};

describe('SystemHealthCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders overall health status and metric summary counts', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    expect(screen.getByText('Operational with Warnings')).toBeInTheDocument();
    expect(screen.getAllByText('13').length).toBeGreaterThanOrEqual(1); // Total signals
    expect(screen.getAllByText('11').length).toBeGreaterThanOrEqual(1); // Healthy count
    expect(screen.getAllByText('Action Required').length).toBeGreaterThanOrEqual(1);
  });

  it('renders all diagnostic check cards initially', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    expect(screen.getByRole('heading', { name: 'PostgreSQL Database' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scheduler and workers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Background jobs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Encryption configuration' })).toBeInTheDocument();
  });

  it('filters check cards by category when clicking a category chip', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    // Click "Database & Storage" chip
    const dbChip = screen.getByRole('button', { name: /database & storage/i });
    fireEvent.click(dbChip);

    expect(screen.getByRole('heading', { name: 'PostgreSQL Database' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Database capacity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Database migrations' })).toBeInTheDocument();

    // Other categories should be hidden
    expect(
      screen.queryByRole('heading', { name: 'Scheduler and workers' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Encryption configuration' })
    ).not.toBeInTheDocument();
  });

  it('filters check cards by search keyword', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const searchInput = screen.getByPlaceholderText(/search diagnostic signals/i);
    fireEvent.change(searchInput, { target: { value: 'encryption' } });

    expect(screen.getByRole('heading', { name: 'Encryption configuration' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PostgreSQL Database' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Scheduler and workers' })
    ).not.toBeInTheDocument();
  });

  it('filters to only attention-required cards when toggling Needs Attention Only', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const attentionToggle = screen.getByRole('button', { name: /needs attention only/i });
    fireEvent.click(attentionToggle);

    // Only degraded (Scheduler) and unhealthy (Background jobs) should be visible
    expect(screen.getByRole('heading', { name: 'Scheduler and workers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Background jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PostgreSQL Database' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Encryption configuration' })
    ).not.toBeInTheDocument();
  });

  it('re-runs diagnostics when clicking the Re-run Diagnostics button', async () => {
    const { refreshAdminHealthAction } = await import('@/app/(app)/settings/system/actions');
    vi.mocked(refreshAdminHealthAction).mockResolvedValue({
      report: {
        ...mockReport,
        overall: 'healthy',
        checks: mockReport.checks.map(c => ({ ...c, status: 'healthy' })),
      },
    });

    render(<SystemHealthCenter initialReport={mockReport} />);

    const rerunBtn = screen.getByRole('button', { name: /re-run diagnostics/i });
    fireEvent.click(rerunBtn);

    await waitFor(() => {
      expect(refreshAdminHealthAction).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no checks match search and resets filters on button click', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const searchInput = screen.getByPlaceholderText(/search diagnostic signals/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } });

    expect(screen.getByText('No Diagnostic Signals Found')).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /reset all filters/i });
    fireEvent.click(resetBtn);

    expect(screen.getByRole('heading', { name: 'PostgreSQL Database' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scheduler and workers' })).toBeInTheDocument();
  });
});
