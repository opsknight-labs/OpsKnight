import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import TableWidget from '@/components/reports/widgets/TableWidget';

describe('TableWidget', () => {
  it('resolves nested object properties such as user.name and schedule.name for currentShifts', () => {
    const data = [
      {
        user: { name: 'Alice Engineer' },
        schedule: { name: 'Primary On-Call' },
      },
      {
        user: { name: 'Bob Responder' },
        schedule: { name: 'Secondary Escalation' },
      },
    ];

    render(
      <TableWidget
        metricKey="currentShifts"
        data={data}
      />
    );

    expect(screen.getByText('Alice Engineer')).toBeDefined();
    expect(screen.getByText('Primary On-Call')).toBeDefined();
    expect(screen.getByText('Bob Responder')).toBeDefined();
    expect(screen.getByText('Secondary Escalation')).toBeDefined();
  });

  it('renders "–" instead of "0%" or error when SLA compliance rates are null/undefined', () => {
    const data = [
      {
        name: 'Billing Gateway',
        ackRate: null,
        resolveRate: undefined,
        total: 15,
      },
    ];

    render(
      <TableWidget
        metricKey="serviceSlaTable"
        data={data}
      />
    );

    expect(screen.getByText('Billing Gateway')).toBeDefined();
    const dashes = screen.getAllByText('–');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('displays empty state when data array is empty', () => {
    render(
      <TableWidget
        metricKey="topServices"
        data={[]}
      />
    );

    expect(screen.getByText('No data available')).toBeDefined();
  });
});
