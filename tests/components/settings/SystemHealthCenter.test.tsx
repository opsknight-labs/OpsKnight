import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SystemHealthCenter from '@/components/settings/SystemHealthCenter';
import type { AdminHealthReport } from '@/lib/admin-health';

vi.mock('@/app/(app)/settings/system/actions', () => ({
  refreshAdminHealthAction: vi.fn(),
  refreshSingleHealthCheckAction: vi.fn(),
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
  history: [
    {
      timestamp: '2026-09-02T11:00:00.000Z',
      hourLabel: '11:00',
      status: 'healthy',
      scorePercent: 100,
    },
    {
      timestamp: '2026-09-02T12:00:00.000Z',
      hourLabel: '12:00',
      status: 'degraded',
      scorePercent: 85,
    },
  ],
  checks: [
    {
      id: 'database',
      label: 'PostgreSQL Database',
      category: 'database',
      status: 'healthy',
      summary: 'PostgreSQL responded in 12 ms.',
      details: ['Connection check passed.'],
      telemetry: {
        latencyMs: 12,
        latencyThresholdMs: 1000,
        rawPayload: { latencyMs: 12, pingQuery: 'SELECT 1' },
      },
      action: { label: 'Monitoring guide', href: 'https://opsknight.com/docs/monitoring' },
    },
    {
      id: 'database-capacity',
      label: 'Database capacity',
      category: 'database',
      status: 'healthy',
      summary: '15 of 100 connections in use (15%).',
      details: ['Active connections: 4', 'Database size: 45.2 MiB'],
      telemetry: {
        poolUtilization: {
          used: 15,
          max: 100,
          percent: 15,
          active: 4,
          sizeFormatted: '45.2 MiB',
          longTx: 0,
        },
      },
    },
    {
      id: 'migrations',
      label: 'Database migrations',
      category: 'database',
      status: 'degraded',
      summary: '2 packaged migration(s) are not applied.',
      details: ['Applied records: 28', 'Pending: 20260901_add_quiet_hours'],
      commandSnippet: {
        command: 'npx prisma migrate deploy',
        description: 'Deploy packaged Prisma migrations to PostgreSQL',
        steps: [
          'Take a full database snapshot or backup before migrating.',
          'Run "npx prisma migrate deploy" in your terminal or container.',
          'Run "npx prisma migrate status" to confirm all migrations applied successfully.',
        ],
      },
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
      telemetry: {
        queueDistribution: {
          pending: 12,
          processing: 2,
          failed: 1,
          overdue: 0,
          stale: 1,
        },
      },
    },
    {
      id: 'sla-performance',
      label: 'SLA query performance',
      category: 'workers',
      status: 'healthy',
      summary: '142 queries in 24 hours; p95 180 ms.',
      details: ['Average: 45 ms', 'p50: 32 ms'],
      telemetry: {
        slaMetrics: {
          p95Ms: 180,
          p50Ms: 32,
          avgMs: 45,
          sampleCount: 142,
        },
      },
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
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders overall health status, history ribbon, and metric summary counts inside DetailHeroBanner', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    expect(screen.getByRole('heading', { name: 'System Health Center' })).toBeInTheDocument();
    expect(screen.getByText('Operational with Warnings')).toBeInTheDocument();
    expect(screen.getByText('24-Hour System Health Trend')).toBeInTheDocument();
    expect(screen.getAllByText('13').length).toBeGreaterThanOrEqual(1); // Total signals
  });

  it('renders visual telemetry gauges, latency pills, and queue distribution bars', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    // Latency pills
    expect(screen.getByText('12ms')).toBeInTheDocument();
    expect(screen.getByText('p95: 180ms')).toBeInTheDocument();

    // Pool utilization gauge
    expect(screen.getByText('Pool Utilization')).toBeInTheDocument();
    expect(screen.getByText('15 / 100 (15%)')).toBeInTheDocument();

    // Queue distribution gauge
    expect(screen.getByText('Queue Distribution')).toBeInTheDocument();
    expect(screen.getByText('Pending: 12')).toBeInTheDocument();
  });

  it('renders migration command box and copies command to clipboard', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    expect(screen.getByText('npx prisma migrate deploy')).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: /copy command/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npx prisma migrate deploy');
  });

  it('opens technical diagnostics inspector modal on Inspect click', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const inspectBtn = screen.getByRole('button', { name: /inspect postgresql database/i });
    fireEvent.click(inspectBtn);

    expect(screen.getByText('Live JSON Telemetry Payload')).toBeInTheDocument();
    expect(screen.getByText(/Diagnostic Facts/)).toBeInTheDocument();
  });

  it('filters check cards by category when clicking a DetailTabs tab', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const dbTab = screen.getByRole('tab', { name: /database/i });
    fireEvent.pointerDown(dbTab, { button: 0 });
    fireEvent.click(dbTab);
    fireEvent.keyDown(dbTab, { key: 'Enter' });

    expect(screen.getByText('PostgreSQL Database')).toBeInTheDocument();
    expect(screen.getByText('Database capacity')).toBeInTheDocument();
    expect(screen.getByText('Database migrations')).toBeInTheDocument();

    expect(screen.queryByText('Scheduler and workers')).not.toBeInTheDocument();
    expect(screen.queryByText('Encryption configuration')).not.toBeInTheDocument();
  });

  it('filters to only attention-required cards when toggling Needs Attention Only', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    const attentionToggle = screen.getByRole('button', { name: /needs attention only/i });
    fireEvent.click(attentionToggle);

    expect(screen.getByText('Scheduler and workers')).toBeInTheDocument();
    expect(screen.getByText('Background jobs')).toBeInTheDocument();
    expect(screen.queryByText('PostgreSQL Database')).not.toBeInTheDocument();
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

  it('renders countdown badge when Live (30s) auto-refresh is toggled on', () => {
    render(<SystemHealthCenter initialReport={mockReport} />);

    expect(screen.queryByLabelText('Refresh countdown')).not.toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: /toggle live 30s refresh/i });
    fireEvent.click(toggle);

    expect(screen.getByLabelText('Refresh countdown')).toBeInTheDocument();
    expect(screen.getByText('30s')).toBeInTheDocument();
  });

  it('re-tests a single health check when clicking its Re-test button', async () => {
    const { refreshSingleHealthCheckAction } = await import('@/app/(app)/settings/system/actions');
    vi.mocked(refreshSingleHealthCheckAction).mockResolvedValue({
      check: {
        ...mockReport.checks[0],
        summary: 'PostgreSQL responded in 8 ms.',
        telemetry: { latencyMs: 8 },
      },
    });

    render(<SystemHealthCenter initialReport={mockReport} />);

    const retestBtn = screen.getByRole('button', { name: /re-test postgresql database/i });
    fireEvent.click(retestBtn);

    await waitFor(() => {
      expect(refreshSingleHealthCheckAction).toHaveBeenCalledWith('database');
      expect(screen.getByText('PostgreSQL responded in 8 ms.')).toBeInTheDocument();
    });
  });
});
