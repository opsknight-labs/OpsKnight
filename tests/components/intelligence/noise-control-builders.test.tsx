import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  createWindowAction: vi.fn(),
  toggleWindowAction: vi.fn(),
  endWindowAction: vi.fn(),
  createRuleAction: vi.fn(),
  createHeartbeatAction: vi.fn(),
  toggleHeartbeatAction: vi.fn(),
  deleteHeartbeatAction: vi.fn(),
}));
const previews = vi.hoisted(() => ({
  previewWindowAction: vi.fn(),
  previewMatchersAction: vi.fn(),
  previewRuleAction: vi.fn(),
  previewOrchestrationAction: vi.fn(),
}));
vi.mock('@/app/(app)/settings/intelligence/noise-controls/actions', () => actions);
vi.mock('@/app/(app)/settings/intelligence/noise-controls/preview-actions', () => previews);

import MaintenanceWindowsPanel, {
  MaintenanceWindowBuilder,
} from '@/components/settings/noise-controls/MaintenanceWindowsPanel';
import SuppressionRuleBuilder, {
  LIVE_PREVIEW_DELAY_MS,
} from '@/components/settings/noise-controls/SuppressionRuleBuilder';
import OrchestrationRulesBuilder from '@/components/settings/noise-controls/OrchestrationRulesBuilder';
import HeartbeatPanel from '@/components/settings/noise-controls/HeartbeatPanel';
import type { MaintenanceWindowView } from '@/lib/intelligence/noise-controls/manage';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls/simulation';

const services = [
  { id: 'svc-a', name: 'Checkout' },
  { id: 'svc-b', name: 'Payments' },
];
const teams = [{ id: 'team-1', name: 'SRE' }];

function outcome(overrides: Partial<SimulationOutcome> = {}): SimulationOutcome {
  return {
    runId: 'run-1',
    days: 7,
    incidentsEvaluated: 12,
    alertsScanned: 40,
    truncated: false,
    pagesAvoided: 4,
    downgraded: 0,
    held: 0,
    transformed: 0,
    failOpen: 0,
    byControl: { MAINTENANCE: 4 },
    byAction: { SUPPRESS: 4 },
    bySource: {},
    matchedRules: {},
    examples: [
      {
        incidentId: 'inc-1',
        serviceId: 'svc-a',
        summary: 'Disk full on db-1',
        action: 'SUPPRESS',
        control: 'MAINTENANCE',
        reason: 'In maintenance window',
        at: new Date('2026-11-07T03:00:00Z'),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MaintenanceWindowBuilder', () => {
  it('shows field errors and does not save an incomplete window', async () => {
    render(<MaintenanceWindowBuilder services={services} teams={teams} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }));
    expect(await screen.findByText('Give the window a name.')).toBeInTheDocument();
    expect(screen.getByText('Pick a service.')).toBeInTheDocument();
    expect(screen.getByText('Enter a start time.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(actions.createWindowAction).not.toHaveBeenCalled();
  });

  it('rejects windows longer than seven days and invalid custom rules', async () => {
    render(<MaintenanceWindowBuilder services={services} teams={teams} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Upgrade' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-a' } });
    fireEvent.change(screen.getByLabelText('Starts (your time)'), {
      target: { value: '2026-12-01T01:00' },
    });
    fireEvent.change(screen.getByLabelText('Ends (your time)'), {
      target: { value: '2026-12-10T01:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }));
    expect(await screen.findByText('A window lasts at most seven days.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Ends (your time)'), {
      target: { value: '2026-12-01T03:00' },
    });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('RRULE'), { target: { value: 'FREQ=HOURLY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }));
    expect(await screen.findByText(/FREQ must be DAILY, WEEKLY or MONTHLY/)).toBeInTheDocument();
    expect(actions.createWindowAction).not.toHaveBeenCalled();
  });

  it('lists upcoming occurrences for a preset and renders the 7-day preview', async () => {
    previews.previewWindowAction.mockResolvedValue({
      ok: true,
      data: {
        outcome: outcome(),
        shiftedWeeks: 2,
        replayedFrom: new Date('2026-11-02T00:00:00Z'),
        replayedTo: new Date('2026-11-09T00:00:00Z'),
      },
    });
    render(<MaintenanceWindowBuilder services={services} teams={teams} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Weekend batch' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-a' } });
    fireEvent.change(screen.getByLabelText('Starts (your time)'), {
      target: { value: '2030-01-05T01:00' },
    });
    fireEvent.change(screen.getByLabelText('Ends (your time)'), {
      target: { value: '2030-01-05T03:00' },
    });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'weekends' } });
    const upcoming = screen.getByRole('list', { name: 'Upcoming occurrences' });
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Test against the last 7 days' }));
    await screen.findByText(/4 of 12 incidents would not have paged/);
    expect(
      screen.getByText(/replayed at the same weekday and time 2 weeks earlier/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disk full on db-1' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    const input = previews.previewWindowAction.mock.calls[0][0];
    expect(input).toMatchObject({
      name: 'Weekend batch',
      scope: 'SERVICE',
      serviceId: 'svc-a',
      recurrence: 'FREQ=WEEKLY;BYDAY=SA,SU',
      effect: 'SUPPRESS',
    });
    expect(Date.parse(input.endsAt) - Date.parse(input.startsAt)).toBe(2 * 3_600_000);
  });

  it('announces preview failures', async () => {
    previews.previewWindowAction.mockResolvedValue({ ok: false, message: 'Not allowed.' });
    render(<MaintenanceWindowBuilder services={services} teams={teams} />);
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'ALL' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Everything' } });
    fireEvent.change(screen.getByLabelText('Starts (your time)'), {
      target: { value: '2026-12-01T01:00' },
    });
    // Picking a start fills a two-hour end.
    expect(screen.getByLabelText('Ends (your time)')).toHaveValue('2026-12-01T03:00');
    fireEvent.click(screen.getByRole('button', { name: 'Test against the last 7 days' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
  });
});

describe('MaintenanceWindowsPanel', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const window: MaintenanceWindowView = {
    id: 'win-1',
    name: 'DB patching',
    description: null,
    scope: 'SERVICE',
    serviceId: 'svc-a',
    serviceName: 'Checkout',
    teamId: null,
    labelKey: null,
    labelValue: null,
    startsAt: new Date('2026-11-09T11:00:00Z'),
    endsAt: new Date('2026-11-09T13:00:00Z'),
    recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    effect: 'SUPPRESS',
    downgradeUrgency: null,
    enabled: true,
    endedAt: null,
    active: true,
    nextSpan: {
      startsAt: new Date('2026-11-09T11:00:00Z'),
      endsAt: new Date('2026-11-09T13:00:00Z'),
    },
  };

  it('shows an agenda with recurring occurrences and an end-now control', () => {
    render(
      <MaintenanceWindowsPanel
        windows={[window]}
        services={services}
        teams={teams}
        canManage
        now={now}
      />
    );
    const agenda = screen.getByRole('list', { name: 'Maintenance agenda' });
    expect(within(agenda).getAllByText('DB patching')).toHaveLength(3);
    expect(within(agenda).getByText('In progress')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'End DB patching now' }).length).toBeGreaterThan(
      0
    );
  });

  it('edits by creating the updated window, then disabling the original', async () => {
    actions.createWindowAction.mockResolvedValue({
      ok: true,
      message: 'Maintenance window saved.',
    });
    actions.toggleWindowAction.mockResolvedValue({ ok: true, message: 'Window updated.' });
    render(
      <MaintenanceWindowsPanel
        windows={[window]}
        services={services}
        teams={teams}
        canManage
        now={now}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit DB patching' }));
    const form = screen.getByRole('form', { name: 'Edit maintenance window DB patching' });
    expect(within(form).getByLabelText('Name')).toHaveFocus();
    expect(within(form).getByLabelText('Name')).toHaveValue('DB patching');
    expect(within(form).getByLabelText('Repeats')).toHaveValue('weekly');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'DB patching v2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(actions.toggleWindowAction).toHaveBeenCalled());
    const created = actions.createWindowAction.mock.calls[0][1] as FormData;
    expect(created.get('name')).toBe('DB patching v2');
    expect(created.get('recurrence')).toBe('FREQ=WEEKLY;BYDAY=MO');
    const toggled = actions.toggleWindowAction.mock.calls[0][1] as FormData;
    expect(toggled.get('id')).toBe('win-1');
    expect(toggled.get('enabled')).toBe('false');
  });

  it('shows read-only viewers an empty state without builders', () => {
    render(
      <MaintenanceWindowsPanel
        windows={[]}
        services={services}
        teams={teams}
        canManage={false}
        now={now}
      />
    );
    expect(screen.getByText('No maintenance scheduled')).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('SuppressionRuleBuilder', () => {
  const owners = [
    { id: 'user-1', name: 'Ada' },
    { id: 'user-2', name: 'Grace' },
  ];

  it('runs a debounced live match preview only for valid conditions', async () => {
    vi.useFakeTimers();
    try {
      previews.previewMatchersAction.mockResolvedValue({
        ok: true,
        data: {
          days: 7,
          alertsScanned: 10,
          matchedAlerts: 3,
          matchedIncidents: 2,
          truncated: false,
          examples: [
            {
              incidentId: 'inc-9',
              summary: 'Synthetic check failed',
              source: 'pingdom',
              severity: 'warning',
              at: new Date('2026-11-08T00:00:00Z'),
            },
          ],
        },
      });
      render(<SuppressionRuleBuilder services={services} owners={owners} currentUserId="user-1" />);
      // An empty value is not a valid condition: nothing is sent.
      await act(async () => {
        vi.advanceTimersByTime(LIVE_PREVIEW_DELAY_MS * 2);
      });
      expect(previews.previewMatchersAction).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'warn' } });
      fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'warning' } });
      await act(async () => {
        vi.advanceTimersByTime(LIVE_PREVIEW_DELAY_MS + 10);
      });
      expect(previews.previewMatchersAction).toHaveBeenCalledTimes(1);
      expect(previews.previewMatchersAction).toHaveBeenCalledWith({
        matchers: [{ field: 'severity', op: 'equals', value: 'warning' }],
        serviceId: null,
      });
      const live = screen.getByTestId('live-match-preview');
      expect(live).toHaveAttribute('aria-live', 'polite');
      expect(live).toHaveTextContent('Matches 3 of 10 alerts (2 incidents) in the last 7 days');
      expect(
        within(live).getByRole('link', { name: 'Synthetic check failed' })
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows validation errors and blocks saving', async () => {
    render(<SuppressionRuleBuilder services={services} owners={owners} currentUserId="user-1" />);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'regex' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '(a+)+' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await screen.findByText('Give the rule a name.')).toBeInTheDocument();
    expect(screen.getByText(/Condition 1: Nested or stacked quantifiers/)).toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveAttribute('aria-invalid', 'true');
    expect(actions.createRuleAction).not.toHaveBeenCalled();
  });

  it('saves several conditions with owner and expiry through the existing action, and replays the rule', async () => {
    actions.createRuleAction.mockResolvedValue({ ok: true, message: 'Suppression rule saved.' });
    previews.previewRuleAction.mockResolvedValue({
      ok: true,
      data: outcome({ byControl: { SUPPRESSION: 4 } }),
    });
    render(<SuppressionRuleBuilder services={services} owners={owners} currentUserId="user-1" />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mute staging' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-b' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'info' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    const fields = screen.getAllByLabelText('Field');
    fireEvent.change(fields[1], { target: { value: 'label' } });
    fireEvent.change(screen.getByLabelText('Label key'), { target: { value: 'env' } });
    fireEvent.change(screen.getAllByLabelText('Value')[1], { target: { value: 'staging' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'user-2' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '7d' } });

    fireEvent.click(screen.getByRole('button', { name: 'Test against the last 7 days' }));
    await screen.findByText(/4 of 12 incidents would not have paged/);
    expect(previews.previewRuleAction.mock.calls[0][0]).toMatchObject({
      serviceId: 'svc-b',
      ownerId: 'user-2',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await screen.findByText('Suppression rule saved.');
    const form = actions.createRuleAction.mock.calls[0][1] as FormData;
    expect(JSON.parse(String(form.get('matchers')))).toEqual([
      { field: 'severity', op: 'equals', value: 'info' },
      { field: 'label', key: 'env', op: 'equals', value: 'staging' },
    ]);
    expect(form.get('ownerId')).toBe('user-2');
    expect(form.get('serviceId')).toBe('svc-b');
    const expires = Date.parse(String(form.get('expiresAt')));
    expect(expires - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  });
});

describe('OrchestrationRulesBuilder', () => {
  const rules = [
    {
      id: 'drop-test',
      name: 'Drop test',
      enabled: true,
      conditions: [{ field: 'label' as const, key: 'env', op: 'equals' as const, value: 'test' }],
      actions: [{ type: 'DROP' as const }],
    },
    {
      id: 'lower-info',
      name: 'Lower info',
      enabled: true,
      conditions: [{ field: 'severity' as const, op: 'equals' as const, value: 'info' }],
      actions: [{ type: 'SET_URGENCY' as const, value: 'LOW' as const }],
    },
  ];
  const posted = (container: HTMLElement) =>
    JSON.parse(
      (container.querySelector('input[name="orchestration"]') as HTMLInputElement).value
    ) as Array<{ id: string }>;

  it('reorders with the keyboard on the handle and announces the move', async () => {
    const { container } = render(
      <OrchestrationRulesBuilder
        initialRules={rules}
        services={services}
        serviceId={null}
        canManage
      />
    );
    const handle = screen.getByRole('button', { name: 'Reorder Drop test, position 1 of 2' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(posted(container).map(rule => rule.id)).toEqual(['lower-info', 'drop-test']);
    expect(screen.getByText('Moved Drop test to position 2 of 2.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reorder Drop test, position 2 of 2' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move Drop test up' }));
    expect(posted(container).map(rule => rule.id)).toEqual(['drop-test', 'lower-info']);
  });

  it('reorders by drag and drop', () => {
    const { container } = render(
      <OrchestrationRulesBuilder
        initialRules={rules}
        services={services}
        serviceId={null}
        canManage
      />
    );
    const items = screen
      .getAllByRole('listitem')
      .filter(
        item => item.parentElement?.getAttribute('aria-label') === 'Orchestration rules in order'
      );
    fireEvent.dragStart(screen.getByRole('button', { name: /Reorder Lower info/ }), {
      dataTransfer: { effectAllowed: '' },
    });
    fireEvent.dragOver(items[0]);
    fireEvent.drop(items[0]);
    expect(posted(container).map(rule => rule.id)).toEqual(['lower-info', 'drop-test']);
  });

  it('builds a rule with the action picker and flags invalid ones', () => {
    const { container } = render(
      <OrchestrationRulesBuilder initialRules={[]} services={services} serviceId={null} canManage />
    );
    expect(screen.getByText('No orchestration rules.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i);
    fireEvent.change(screen.getByLabelText('Name of rule 1'), {
      target: { value: 'Route DB alerts' },
    });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'postgres' } });
    fireEvent.change(screen.getByLabelText('Action 1'), { target: { value: 'REROUTE_SERVICE' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-b' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(posted(container)).toEqual([
      {
        id: 'route-db-alerts',
        name: 'Route DB alerts',
        enabled: true,
        conditions: [{ field: 'severity', op: 'equals', value: 'postgres' }],
        actions: [{ type: 'REROUTE_SERVICE', serviceId: 'svc-b' }],
      },
    ]);
  });

  it('shows per-rule replay counts', async () => {
    previews.previewOrchestrationAction.mockResolvedValue({
      ok: true,
      data: outcome({ matchedRules: { 'drop-test': 5 }, bySource: { 'drop-test': 5 } }),
    });
    render(
      <OrchestrationRulesBuilder
        initialRules={rules}
        services={services}
        serviceId="svc-a"
        canManage
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test rules against the last 7 days' }));
    expect(await screen.findByText('Matched 5 incidents in 7 days')).toBeInTheDocument();
    expect(screen.getByText('Matched 0 incidents in 7 days')).toBeInTheDocument();
    expect(screen.getByText(/5 dropped or suppressed/)).toBeInTheDocument();
    expect(previews.previewOrchestrationAction.mock.calls[0][0]).toMatchObject({
      serviceId: 'svc-a',
      rules: [{ id: 'drop-test' }, { id: 'lower-info' }],
    });
  });

  it('is read-only for viewers', () => {
    render(
      <OrchestrationRulesBuilder
        initialRules={rules}
        services={services}
        serviceId={null}
        canManage={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Move Lower info up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
  });
});

describe('HeartbeatPanel', () => {
  const monitor = {
    id: 'hb-1',
    name: 'Nightly backup',
    serviceName: 'Checkout',
    tokenPrefix: 'abc123',
    intervalSeconds: 86_400,
    graceSeconds: 600,
    urgency: 'HIGH',
    enabled: true,
    state: 'MISSING',
    lastPingAt: null,
    dueAt: new Date('2026-11-09T00:00:00Z'),
    lastIncidentId: 'inc-7',
  };

  it('shows status, last ping and the last incident', () => {
    render(
      <HeartbeatPanel
        monitors={[monitor]}
        services={services}
        canManage={false}
        appUrl="https://ops.example.com"
      />
    );
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText(/every 1 d \(\+10 min grace\)/)).toBeInTheDocument();
    expect(screen.getByText(/Last ping never/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'last incident' })).toHaveAttribute(
      'href',
      '/incidents/inc-7'
    );
    expect(screen.queryByRole('form', { name: 'New heartbeat monitor' })).toBeNull();
  });

  it('shows the ping URL and token once, with copy buttons', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    actions.createHeartbeatAction.mockResolvedValue({
      ok: true,
      message: 'Heartbeat monitor created.',
      token: 'tok_secret',
    });
    render(
      <HeartbeatPanel
        monitors={[]}
        services={services}
        canManage
        appUrl="https://ops.example.com/"
      />
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Backup' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create monitor' }));
    const box = await screen.findByTestId('heartbeat-token');
    expect(within(box).getByLabelText('Ping URL')).toHaveValue(
      'https://ops.example.com/api/heartbeats/tok_secret'
    );
    expect(within(box).getByLabelText('Token')).toHaveValue('tok_secret');
    fireEvent.click(within(box).getByRole('button', { name: 'Copy ping url' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://ops.example.com/api/heartbeats/tok_secret')
    );
    expect(await within(box).findByText('Ping URL copied')).toBeInTheDocument();
  });
});
