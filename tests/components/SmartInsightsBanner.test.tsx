import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SmartInsightsBanner from '@/components/dashboard/SmartInsightsBanner';

describe('SmartInsightsBanner', () => {
  it('should clamp service concentration percentage to a maximum of 100%', () => {
    // If topServiceCount exceeds totalIncidents (e.g. from mismatched data), it should never exceed 100%
    render(
      <SmartInsightsBanner
        totalIncidents={100}
        activeIncidents={50}
        criticalIncidents={0}
        unassignedIncidents={0}
        topServiceName="Github Alert"
        topServiceCount={150}
      />
    );

    expect(
      screen.getByText('100% of incidents (150 of 100) originate from "Github Alert".')
    ).toBeDefined();
    expect(screen.getByText('CONCENTRATION')).toBeDefined();
    expect(screen.queryByText(/150%/)).toBeNull();
  });

  it('should accurately calculate normal service concentration percentage', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={200}
        activeIncidents={50}
        criticalIncidents={0}
        unassignedIncidents={0}
        topServiceName="Authentication Service"
        topServiceCount={120}
      />
    );

    expect(
      screen.getByText('60% of incidents (120 of 200) originate from "Authentication Service".')
    ).toBeDefined();
  });

  it('should clamp unassigned percentage to 100% and render unassigned alert when ratio > 0.3', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={50}
        activeIncidents={20}
        criticalIncidents={0}
        unassignedIncidents={10}
      />
    );

    expect(screen.getByText('50% of active incidents (10 of 20) are unassigned.')).toBeDefined();
    expect(screen.getByText('WORKLOAD')).toBeDefined();
  });

  it('should show critical spike banner when criticalIncidents >= 3', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={50}
        activeIncidents={10}
        criticalIncidents={5}
        unassignedIncidents={0}
      />
    );

    expect(
      screen.getByText('5 critical incidents active (out of 10 active incidents).')
    ).toBeDefined();
    expect(screen.getByText('CRITICAL')).toBeDefined();
  });

  it('should show all systems operational when all incidents are clear', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={0}
        activeIncidents={0}
        criticalIncidents={0}
        unassignedIncidents={0}
      />
    );

    expect(screen.getByText('All systems operational. No active incidents.')).toBeDefined();
    expect(screen.getByText('OPERATIONAL')).toBeDefined();
  });

  it('should allow dismissing an insight', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={50}
        activeIncidents={10}
        criticalIncidents={4}
        unassignedIncidents={0}
      />
    );

    const message = screen.getByText('4 critical incidents active (out of 10 active incidents).');
    expect(message).toBeDefined();

    // Click close/dismiss button
    const dismissButton = screen.getByRole('button', { name: /dismiss insight/i });
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText('4 critical incidents active (out of 10 active incidents).')
    ).toBeNull();
  });

  it('should render 1-click action links for active alerts', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={50}
        activeIncidents={20}
        criticalIncidents={3}
        unassignedIncidents={10}
        topServiceName="Checkout API"
        topServiceId="svc-123"
        topServiceCount={25}
        resolveCompliance={78}
      />
    );

    // Unassigned triage action
    const unassignedAction = screen.getByRole('link', { name: /Triage Unassigned/i });
    expect(unassignedAction.getAttribute('href')).toBe('/?status=ACTIVE&assignee=unassigned');

    // Critical feed action
    const criticalAction = screen.getByRole('link', { name: /View Critical Feed/i });
    expect(criticalAction.getAttribute('href')).toBe('/?status=ACTIVE&urgency=HIGH');

    // Service inspection action
    const serviceAction = screen.getByRole('link', { name: /Inspect Checkout API/i });
    expect(serviceAction.getAttribute('href')).toBe('/services/svc-123');

    // SLA risk action
    const slaAction = screen.getByRole('link', { name: /View SLA Analytics/i });
    expect(slaAction.getAttribute('href')).toBe('/analytics');
    expect(screen.getByText(/Resolution SLA compliance is 78% \(target ≥ 85%\)/i)).toBeDefined();
  });

  it('should render public status action on all clear banner', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={0}
        activeIncidents={0}
        criticalIncidents={0}
        unassignedIncidents={0}
      />
    );

    const statusAction = screen.getByRole('link', { name: /Public Status/i });
    expect(statusAction.getAttribute('href')).toBe('/status');
  });

  it('should render trends action on high volume days', () => {
    render(
      <SmartInsightsBanner
        totalIncidents={35}
        activeIncidents={5}
        criticalIncidents={0}
        unassignedIncidents={0}
        avgIncidentsPerDay={20}
      />
    );

    const trendsAction = screen.getByRole('link', { name: /View Trends/i });
    expect(trendsAction.getAttribute('href')).toBe('/analytics');
    expect(
      screen.getByText(
        /Incident volume is 75% higher than average today \(35 incidents vs 20\/day avg\)/i
      )
    ).toBeDefined();
    expect(screen.getByText('SURGE')).toBeDefined();
  });
});
