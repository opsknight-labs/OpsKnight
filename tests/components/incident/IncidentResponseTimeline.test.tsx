import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentResponseTimeline, {
  recordLink,
} from '@/components/incident/detail/IncidentResponseTimeline';
import IncidentContextCard from '@/components/incident/detail/IncidentContextCard';
import type {
  IncidentContextView,
  IncidentResponseTimeline as Timeline,
  ResponseTimelineEntry,
} from '@/lib/incidents/response-timeline';

const lanes = (
  overrides: Partial<Record<string, { visible?: boolean; restricted?: boolean }>> = {},
  entries: ResponseTimelineEntry[] = []
): Timeline['lanes'] => {
  const byLane = new Map(Object.entries(overrides));
  return (['ROUTING', 'PAGING', 'REMEDIATION', 'VERIFICATION', 'RECOVERY'] as const).map(lane => ({
    lane,
    visible: byLane.get(lane)?.visible ?? true,
    restricted: byLane.get(lane)?.restricted ?? false,
    count: entries.filter(entry => entry.lane === lane).length,
  }));
};

const entries: ResponseTimelineEntry[] = [
  {
    id: 'incident:1',
    kind: 'INCIDENT_TRIGGERED',
    lane: 'ROUTING',
    at: '2026-10-19T10:00:00.000Z',
    title: 'Incident triggered',
    detail: null,
    tone: 'critical',
    facts: [],
  },
  {
    id: 'decision:1',
    kind: 'ROUTING_DECISION',
    lane: 'ROUTING',
    at: '2026-10-19T10:00:01.000Z',
    title: 'Matched rule: EU payments',
    detail: null,
    tone: 'info',
    mode: 'LIVE',
    routeType: 'ESCALATION_POLICY',
    fallback: false,
    record: { type: 'DECISION', id: 'inc-1' },
    facts: [{ label: 'Priority', value: 'P3 → P1' }],
  },
  {
    id: 'escalation:0:0',
    kind: 'ESCALATION_STEP',
    lane: 'PAGING',
    at: '2026-10-19T10:01:00.000Z',
    title: 'Escalation step 1 · Primary',
    detail: null,
    tone: 'oncall',
    stepNumber: 1,
    outcome: 'COMPLETED',
    facts: [],
  },
  {
    id: 'execution:x1:started',
    kind: 'RUNBOOK_EXECUTION',
    lane: 'REMEDIATION',
    at: '2026-10-19T10:05:00.000Z',
    title: 'Runbook started: Restart web',
    detail: null,
    tone: 'warning',
    executionId: 'x1',
    status: 'SUCCEEDED',
    phase: 'STARTED',
    record: { type: 'EXECUTION', id: 'x1' },
    facts: [{ label: 'Write actions', value: 'Unattended writes authorized' }],
  },
  {
    id: 'verification:st2',
    kind: 'WRITE_VERIFICATION',
    lane: 'VERIFICATION',
    at: '2026-10-19T10:10:00.000Z',
    title: 'Verified: Restart service',
    detail: '<script>alert(1)</script>',
    tone: 'success',
    executionId: 'x1',
    stepId: 'st2',
    verified: true,
    facts: [],
  },
  {
    id: 'recovery:x1',
    kind: 'RECOVERY_OUTCOME',
    lane: 'RECOVERY',
    at: '2026-10-19T10:12:00.000Z',
    title: 'Resolved after verified recovery: Restart web',
    detail: null,
    tone: 'success',
    executionId: 'x1',
    outcome: 'RESOLVED',
    facts: [],
  },
];

const timeline: Timeline = {
  incidentId: 'inc-1',
  entries,
  truncated: false,
  lanes: lanes({}, entries),
  context: { visibility: 'HIDDEN' },
  humanInterventionRequired: false,
};

describe('IncidentResponseTimeline', () => {
  it('renders an ordered, labelled list with machine-readable times', () => {
    render(<IncidentResponseTimeline timeline={timeline} timeZone="UTC" />);
    expect(screen.getByRole('heading', { name: /Response activity/ })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Response timeline entries' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(entries.length);
    expect(items[0].textContent).toContain('Incident triggered');
    expect(items[0].querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-10-19T10:00:00.000Z'
    );
    expect(screen.getByText('P3 → P1')).toBeTruthy();
    // Dynamic content is rendered as text, never as markup.
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('filters by lane with pressed-state chips', () => {
    render(<IncidentResponseTimeline timeline={timeline} timeZone="UTC" />);
    const group = screen.getByRole('group', { name: 'Filter response lanes' });
    const paging = within(group).getByRole('button', { name: 'Paging: 1 entries' });
    fireEvent.click(paging);
    expect(paging.getAttribute('aria-pressed')).toBe('true');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Escalation step 1');
  });

  it('shows empty states for the whole timeline and for an empty lane', () => {
    const empty: Timeline = { ...timeline, entries: [], lanes: lanes() };
    render(<IncidentResponseTimeline timeline={empty} timeZone="UTC" />);
    expect(screen.getByText('No response activity has been recorded yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verification: 0 entries' }));
    expect(screen.getByText('No verification activity has been recorded.')).toBeTruthy();
  });

  it('hides lanes the viewer cannot see and explains restricted lanes', () => {
    const restricted: Timeline = {
      ...timeline,
      entries: entries.filter(
        entry => entry.lane === 'ROUTING' && entry.kind !== 'ROUTING_DECISION'
      ),
      lanes: lanes({
        ROUTING: { restricted: true },
        REMEDIATION: { visible: false },
        VERIFICATION: { visible: false },
        RECOVERY: { restricted: true },
      }),
    };
    render(<IncidentResponseTimeline timeline={restricted} timeZone="UTC" />);
    expect(screen.queryByRole('button', { name: /Remediation/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Verification/ })).toBeNull();
    expect(
      screen.getByText('Routing decision details require automation read access.')
    ).toBeTruthy();
    expect(screen.getByText('Runbook recovery outcomes require Runbook read access.')).toBeTruthy();
  });

  it('handles an unavailable projection', () => {
    render(<IncidentResponseTimeline timeline={null} timeZone="UTC" />);
    expect(
      screen.getByText('The response timeline is unavailable for this incident.')
    ).toBeTruthy();
  });

  it('links each entry to its underlying record', () => {
    render(<IncidentResponseTimeline timeline={timeline} timeZone="UTC" />);
    expect(
      screen.getByRole('link', { name: /View routing decision/ }).getAttribute('href')
    ).toBe('#automation-decision');
    expect(screen.getByRole('link', { name: /View execution/ }).getAttribute('href')).toBe(
      '/runbooks/executions/x1'
    );
    expect(screen.queryAllByRole('link')).toHaveLength(2);
  });

  it('keeps execution links in-page on mobile', () => {
    render(<IncidentResponseTimeline timeline={timeline} timeZone="UTC" compact />);
    expect(screen.getByRole('link', { name: /View execution/ }).getAttribute('href')).toBe(
      '#runbook-execution-x1'
    );
  });

  it('maps every record type to a link target', () => {
    expect(recordLink({ type: 'APPROVAL', id: 's1', executionId: 'x1' }, false).href).toBe(
      '#runbook-execution-x1'
    );
    expect(recordLink({ type: 'NOTIFICATION', id: 'n1' }, false).href).toBe(
      '#timeline-notif-n1'
    );
    expect(recordLink({ type: 'EVENT', id: 'e1' }, true).href).toBe('#timeline-e1');
    expect(recordLink({ type: 'SUGGESTION', id: 'g1' }, false).href).toBe(
      '#runbook-suggestion-g1'
    );
    expect(recordLink({ type: 'ESCALATION_STEP', id: '0' }, false).href).toBe(
      '#escalation-health'
    );
  });

  it('surfaces human intervention, resolution recommendations and waiting approvals', () => {
    const extra: ResponseTimelineEntry[] = [
      {
        id: 'approval:s1',
        kind: 'RUNBOOK_APPROVAL',
        lane: 'REMEDIATION',
        at: '2026-10-19T10:06:00.000Z',
        title: 'Approval required: Restart service',
        detail: 'Waiting for a responder. Paging is not delayed by this approval.',
        tone: 'warning',
        executionId: 'x1',
        stepId: 's1',
        state: 'REQUIRED',
        record: { type: 'APPROVAL', id: 's1', executionId: 'x1' },
        facts: [],
      },
      {
        id: 'event:e1',
        kind: 'RUNBOOK_EVENT',
        lane: 'RECOVERY',
        at: '2026-10-19T10:11:00.000Z',
        title: 'Recovery verified · resolution recommended',
        detail: 'Recovery verified: Restart web (1/1). Resolution recommended: confirm.',
        tone: 'success',
        eventType: 'RUNBOOK_VERIFIED',
        signal: 'RESOLUTION_RECOMMENDED',
        record: { type: 'EVENT', id: 'e1' },
        facts: [],
      },
    ];
    const all = [...entries, ...extra];
    render(
      <IncidentResponseTimeline
        timeline={{ ...timeline, entries: all, lanes: lanes({}, all), humanInterventionRequired: true }}
        timeZone="UTC"
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('Human intervention required');
    expect(screen.getByText('Recovery verified · resolution recommended')).toBeTruthy();
    expect(screen.getByText(/Paging is not delayed/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /View approval/ }).getAttribute('href')).toBe(
      '#runbook-execution-x1'
    );
  });

  it('shows no intervention banner by default', () => {
    render(<IncidentResponseTimeline timeline={timeline} timeZone="UTC" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

const fields = [
  {
    key: 'region',
    type: 'STRING' as const,
    state: 'RECOGNIZED' as const,
    source: 'ALERT' as const,
    value: 'eu-west-1',
    redacted: false,
  },
  {
    key: 'host',
    type: 'STRING' as const,
    state: 'RECOGNIZED' as const,
    source: 'ENRICHMENT' as const,
    value: 'web-01.prod',
    redacted: false,
  },
  {
    key: 'tier',
    type: 'ENUM' as const,
    state: 'UNMAPPED' as const,
    source: 'NONE' as const,
    value: null,
    redacted: false,
  },
];

describe('IncidentContextCard', () => {
  it('shows values, states and sources to sensitive readers', () => {
    render(
      <IncidentContextCard
        context={{ visibility: 'VISIBLE', status: 'AVAILABLE', versionNumber: 4, fields }}
      />
    );
    expect(screen.getByRole('heading', { name: 'Incident context' })).toBeTruthy();
    expect(screen.getByText('Integrity verified · automation v4')).toBeTruthy();
    const region = screen.getByTestId('context-field-region');
    expect(region.textContent).toContain('eu-west-1');
    expect(region.textContent).toContain('Recognized');
    expect(region.textContent).toContain('Alert');
    expect(region.textContent).toContain('Text');
    expect(screen.getByTestId('context-field-tier').textContent).toContain('Enum');
    expect(screen.getByTestId('context-field-host').textContent).toContain('Enrichment');
    expect(screen.getByTestId('context-field-tier').textContent).toContain('Unrecognized value');
  });

  it('redacts values for auditors without sensitive access', () => {
    const redacted: IncidentContextView = {
      visibility: 'REDACTED',
      status: 'AVAILABLE',
      versionNumber: 4,
      fields: fields.map(field => ({
        ...field,
        value: null,
        redacted: field.state === 'RECOGNIZED',
      })),
    };
    const { container } = render(<IncidentContextCard context={redacted} />);
    expect(container.textContent).not.toContain('eu-west-1');
    expect(container.textContent).not.toContain('web-01.prod');
    expect(screen.getByText(/Context values are restricted/)).toBeTruthy();
    expect(screen.getByTestId('context-field-region').textContent).toContain('Restricted');
    expect(screen.getByTestId('context-field-region').textContent).toContain('region');
    expect(screen.getByTestId('context-field-region').textContent).toContain('Text');
    expect(screen.getByText(/automation v4/)).toBeTruthy();
  });

  it('explains unavailable context and integrity failures', () => {
    const { rerender } = render(
      <IncidentContextCard
        context={{ visibility: 'VISIBLE', status: 'UNAVAILABLE', reason: 'INTEGRITY_FAILED' }}
      />
    );
    expect(screen.getByText('Context failed its integrity check')).toBeTruthy();
    expect(screen.getByText(/triggers and targeting are skipped/)).toBeTruthy();
    rerender(
      <IncidentContextCard
        context={{ visibility: 'REDACTED', status: 'UNAVAILABLE', reason: 'FALLBACK' }}
      />
    );
    expect(screen.getByText('Automation fell back to service defaults')).toBeTruthy();
  });

  it('renders an empty state and nothing when hidden', () => {
    const { container, rerender } = render(
      <IncidentContextCard
        context={{ visibility: 'VISIBLE', status: 'AVAILABLE', versionNumber: 1, fields: [] }}
      />
    );
    expect(screen.getByText('The automation version declares no context fields.')).toBeTruthy();
    rerender(<IncidentContextCard context={{ visibility: 'HIDDEN' }} />);
    expect(container.innerHTML).toBe('');
  });
});
