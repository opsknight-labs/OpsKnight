import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import IncidentsV3 from '@/components/status-page/v3/IncidentsV3';

const now = new Date().toISOString();

describe('IncidentsV3 business-service filter', () => {
  it('shows affected business services on the card and filters by them', () => {
    render(
      <IncidentsV3
        timeZone="UTC"
        incidents={[
          {
            id: 'i1',
            title: 'Card payments failing',
            status: 'OPEN',
            createdAt: now,
            service: { id: 's1', name: 'Payments API' },
            businessServices: [{ id: 'b1', name: 'Checkout' }],
          },
          {
            id: 'i2',
            title: 'Search slow',
            status: 'OPEN',
            createdAt: now,
            service: { id: 's2', name: 'Search' },
          },
        ]}
      />
    );
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);
    const select = screen.getByRole('combobox');
    expect(screen.getByRole('group', { name: 'Business services' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'business:b1' } });
    expect(screen.getByText('Card payments failing')).toBeInTheDocument();
    expect(screen.queryByText('Search slow')).not.toBeInTheDocument();
  });
});
