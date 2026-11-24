import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import IncidentDetailTabs, {
  isIncidentTabAvailable,
  tabForAnchor,
} from '@/components/incident/IncidentDetailTabs';

describe('IncidentDetailTabs access control and fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/incidents/inc-123');
  });

  it('determines tab availability based on content presence', () => {
    expect(isIncidentTabAvailable('notes', {})).toBe(true);
    expect(isIncidentTabAvailable('overview', {})).toBe(true);
    expect(isIncidentTabAvailable('timeline', {})).toBe(true);
    expect(isIncidentTabAvailable('automation', { hasAutomation: false })).toBe(false);
    expect(isIncidentTabAvailable('automation', { hasAutomation: true })).toBe(true);
    // Runbooks live in the Automation tab; the old id still resolves there.
    expect(isIncidentTabAvailable('runbooks', { hasRunbooks: false })).toBe(false);
    expect(isIncidentTabAvailable('runbooks', { hasRunbooks: true })).toBe(true);
    expect(isIncidentTabAvailable('automation', { hasRunbooks: true })).toBe(true);
    // Response activity is a view of the Timeline tab.
    expect(isIncidentTabAvailable('response', {})).toBe(true);
    expect(isIncidentTabAvailable('postmortem', { hasPostmortem: false })).toBe(false);
  });

  it('maps anchors to the tab that now holds them', () => {
    expect(tabForAnchor('runbook-execution-1', false)).toBeNull();
    expect(tabForAnchor('runbook-execution-1', true)).toBe('automation');
    expect(tabForAnchor('automation-decision')).toBe('automation');
    expect(tabForAnchor('response-activity')).toBe('timeline');
  });

  it('falls back to Notes when ?tab=runbooks is requested but user lacks runbook access', () => {
    window.history.replaceState(null, '', '/incidents/inc-123?tab=runbooks');

    render(
      <IncidentDetailTabs
        activityContent={<div>Notes list</div>}
        timelineContent={<div>Timeline content</div>}
      />
    );

    expect(screen.getByRole('tab', { name: /notes/i })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('tab', { name: /runbooks/i })).not.toBeInTheDocument();
  });

  it('honors ?tab=runbooks by opening Runbooks & automation', () => {
    window.history.replaceState(null, '', '/incidents/inc-123?tab=runbooks');

    render(
      <IncidentDetailTabs
        activityContent={<div>Notes list</div>}
        timelineContent={<div>Timeline content</div>}
        runbooksContent={<div>Runbook list</div>}
        automationContent={<div>Automation decision</div>}
      />
    );

    expect(screen.getByRole('tab', { name: /runbooks & automation/i })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(screen.getByText('Runbook list')).toBeInTheDocument();
    expect(screen.getByText('Automation decision')).toBeInTheDocument();
  });

  it('opens the response path inside Timeline for ?tab=response, and switches views', () => {
    window.history.replaceState(null, '', '/incidents/inc-123?tab=response');

    render(
      <IncidentDetailTabs
        activityContent={<div>Notes list</div>}
        timelineContent={<div>Event list</div>}
        responseContent={<div>Response lanes</div>}
      />
    );

    expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Response lanes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /events/i }));
    expect(screen.getByText('Event list')).toBeInTheDocument();
  });

  it('shows the Postmortem tab only once it is available', () => {
    const { rerender } = render(
      <IncidentDetailTabs
        activityContent={<div>Notes list</div>}
        timelineContent={<div>Timeline content</div>}
        postmortemContent={<div>Postmortem</div>}
        showPostmortem={false}
      />
    );
    expect(screen.queryByRole('tab', { name: /postmortem/i })).not.toBeInTheDocument();

    rerender(
      <IncidentDetailTabs
        activityContent={<div>Notes list</div>}
        timelineContent={<div>Timeline content</div>}
        postmortemContent={<div>Postmortem</div>}
        showPostmortem
      />
    );
    expect(screen.getByRole('tab', { name: /postmortem/i })).toBeInTheDocument();
  });
});
