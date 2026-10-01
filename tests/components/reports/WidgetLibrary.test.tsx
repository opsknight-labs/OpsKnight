import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import WidgetLibrary from '@/components/reports/WidgetLibrary';

describe('WidgetLibrary', () => {
  it('differentiates widgets sharing the same metricKey by widgetDefinitionId', () => {
    // Both incident-trend and mtta-mttr-trend use metricKey: 'trendSeries'
    // If only 'incident-trend' is added, 'mtta-mttr-trend' should NOT be disabled
    render(
      <WidgetLibrary
        isOpen={true}
        onClose={vi.fn()}
        onAddWidget={vi.fn()}
        existingWidgetDefIds={['incident-trend']}
      />
    );

    // Search for trend widgets
    const searchInput = screen.getByPlaceholderText('Search widgets...');
    fireEvent.change(searchInput, { target: { value: 'trend' } });

    // "Incident Trend" card should be disabled
    const incidentTrendBtn = screen.getByRole('button', { name: /incident trend/i });
    expect(incidentTrendBtn).toHaveProperty('disabled', true);

    // "MTTA/MTTR Trend" card should NOT be disabled
    const mttaMttrBtn = screen.getByRole('button', { name: /mtta\/mttr trend/i });
    expect(mttaMttrBtn).toHaveProperty('disabled', false);
  });

  it('triggers onAddWidget with full definition when a widget card is clicked', () => {
    const handleAdd = vi.fn();
    render(
      <WidgetLibrary
        isOpen={true}
        onClose={vi.fn()}
        onAddWidget={handleAdd}
        existingWidgetDefIds={[]}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search widgets...');
    fireEvent.change(searchInput, { target: { value: 'total incidents' } });

    const totalIncidentsBtn = screen.getByRole('button', { name: /total incidents/i });
    fireEvent.click(totalIncidentsBtn);

    expect(handleAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'total-incidents',
        metricKey: 'totalIncidents',
      })
    );
  });
});
