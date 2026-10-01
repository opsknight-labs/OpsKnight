import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WidgetConfigModal, { ConfigurableWidget } from '@/components/reports/WidgetConfigModal';

describe('WidgetConfigModal Component', () => {
  const mockWidget: ConfigurableWidget = {
    id: 'widget-trend-1',
    widgetType: 'chart',
    metricKey: 'trendSeries',
    widgetDefinitionId: 'incident-trend',
    title: 'Incident Volume Trend',
    position: { x: 0, y: 0, w: 2, h: 2 },
    config: { chartType: 'line', targetSla: 99.5 },
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    widget: mockWidget,
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders widget title, size, and chart visualization settings', () => {
    render(<WidgetConfigModal {...defaultProps} />);

    expect(screen.getByText('Configure Widget')).toBeDefined();
    expect(screen.getByDisplayValue('Incident Volume Trend')).toBeDefined();
    expect(screen.getByText('Column Width')).toBeDefined();
    expect(screen.getByText('Row Height')).toBeDefined();
    expect(screen.getByText('Chart Visualization')).toBeDefined();
  });

  it('allows editing title and applying changes', () => {
    render(<WidgetConfigModal {...defaultProps} />);

    const titleInput = screen.getByDisplayValue('Incident Volume Trend');
    fireEvent.change(titleInput, { target: { value: 'P1 Outages Trend' } });

    const applyBtn = screen.getByRole('button', { name: /apply changes/i });
    fireEvent.click(applyBtn);

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'P1 Outages Trend',
        position: expect.objectContaining({ w: 2, h: 2 }),
      })
    );
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('resets title to default when Reset to default button is clicked', () => {
    render(<WidgetConfigModal {...defaultProps} />);

    // Change title
    const titleInput = screen.getByDisplayValue('Incident Volume Trend');
    fireEvent.change(titleInput, { target: { value: 'Modified Name' } });

    // Reset button should appear
    const resetBtn = screen.getByRole('button', { name: /reset to default/i });
    fireEvent.click(resetBtn);

    // Title should be reset to default definition name "Incident Trend"
    expect(titleInput).toHaveValue('Incident Trend');
  });
});
