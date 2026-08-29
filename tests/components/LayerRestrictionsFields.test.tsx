import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import LayerRestrictionsFields from '@/components/schedules/LayerRestrictionsFields';

describe('LayerRestrictionsFields', () => {
  it('keeps optional controls hidden until requested and exposes useful presets', () => {
    const onSelectedDaysChange = vi.fn();
    const onStartHourChange = vi.fn();
    const onEndHourChange = vi.fn();

    render(
      <LayerRestrictionsFields
        selectedDays={[]}
        onSelectedDaysChange={onSelectedDaysChange}
        startHour=""
        onStartHourChange={onStartHourChange}
        endHour=""
        onEndHourChange={onEndHourChange}
      />
    );

    const trigger = screen.getByRole('button', { name: /layer coverage/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Weekdays' }));
    expect(onSelectedDaysChange).toHaveBeenCalledWith([1, 2, 3, 4, 5]);

    fireEvent.click(screen.getByRole('button', { name: 'Business hours' }));
    expect(onStartHourChange).toHaveBeenCalledWith('9');
    expect(onEndHourChange).toHaveBeenCalledWith('17');
  });

  it('opens customized rules by default when editing', () => {
    render(
      <LayerRestrictionsFields
        selectedDays={[0, 6]}
        onSelectedDaysChange={vi.fn()}
        startHour="18"
        onStartHourChange={vi.fn()}
        endHour="6"
        onEndHourChange={vi.fn()}
        defaultOpen
      />
    );

    expect(screen.getByRole('button', { name: /layer coverage/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('Weekends · 18:00–06:00')).toBeInTheDocument();
  });
});
