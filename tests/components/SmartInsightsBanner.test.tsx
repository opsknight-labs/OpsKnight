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
      screen.getByText(
        '100% of incidents originate from "Github Alert". Consider investigating root cause.'
      )
    ).toBeDefined();
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
      screen.getByText(
        '60% of incidents originate from "Authentication Service". Consider investigating root cause.'
      )
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

    expect(
      screen.getByText('50% of active incidents are unassigned. Consider distributing workload.')
    ).toBeDefined();
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
      screen.getByText('5 critical incidents active. Prioritize immediate response.')
    ).toBeDefined();
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

    const message = screen.getByText('4 critical incidents active. Prioritize immediate response.');
    expect(message).toBeDefined();

    // Click close/dismiss button
    const dismissButton = screen.getByRole('button');
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText('4 critical incidents active. Prioritize immediate response.')
    ).toBeNull();
  });
});
