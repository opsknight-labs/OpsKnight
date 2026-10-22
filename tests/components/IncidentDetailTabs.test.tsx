import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(isIncidentTabAvailable('overview', {})).toBe(true);
    expect(isIncidentTabAvailable('timeline', {})).toBe(true);
    expect(isIncidentTabAvailable('runbooks', { hasRunbooks: false })).toBe(false);
    expect(isIncidentTabAvailable('runbooks', { hasRunbooks: true })).toBe(true);
    expect(isIncidentTabAvailable('response', { hasResponse: false })).toBe(false);
    expect(isIncidentTabAvailable('response', { hasResponse: true })).toBe(true);
  });

  it('maps anchor to null when runbooks are not available', () => {
    expect(tabForAnchor('runbook-execution-1', false)).toBeNull();
    expect(tabForAnchor('runbook-execution-1', true)).toBe('runbooks');
  });

  it('falls back to overview when ?tab=runbooks is requested but user lacks runbook access', () => {
    window.history.replaceState(null, '', '/incidents/inc-123?tab=runbooks');

    render(
      <IncidentDetailTabs
        eventCount={5}
        activityContent={<div>Activity overview</div>}
        timelineContent={<div>Timeline content</div>}
        // runbooksContent omitted (user lacks runbook access)
      />
    );

    // Active tab trigger should be overview, NOT runbooks
    const overviewTrigger = screen.getByRole('tab', { name: /overview/i });
    expect(overviewTrigger).toHaveAttribute('data-state', 'active');
    expect(screen.queryByRole('tab', { name: /runbooks/i })).not.toBeInTheDocument();
  });

  it('honors ?tab=runbooks when user has runbook access (runbooksContent provided)', () => {
    window.history.replaceState(null, '', '/incidents/inc-123?tab=runbooks');

    render(
      <IncidentDetailTabs
        eventCount={5}
        activityContent={<div>Activity overview</div>}
        timelineContent={<div>Timeline content</div>}
        runbooksContent={<div>Runbook list</div>}
      />
    );

    const runbooksTrigger = screen.getByRole('tab', { name: /runbooks/i });
    expect(runbooksTrigger).toHaveAttribute('data-state', 'active');
  });
});
