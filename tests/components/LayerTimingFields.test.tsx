import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LayerTimingFields from '@/components/schedules/LayerTimingFields';

describe('LayerTimingFields', () => {
  it('keeps uncommon layer activity timing out of the primary handoff flow', () => {
    const onRotationDurationChange = vi.fn();
    const onShiftDurationChange = vi.fn();

    render(
      <LayerTimingFields
        rotationDuration="24"
        onRotationDurationChange={onRotationDurationChange}
        shiftDuration=""
        onShiftDurationChange={onShiftDurationChange}
        startDefaultValue="2026-08-29T09:00"
        endDefaultValue="2026-09-29T09:00"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(onRotationDurationChange).toHaveBeenCalledWith('168');

    expect(
      screen.queryByRole('spinbutton', { name: 'Layer active duration' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced layer timing/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Layer active duration' }), {
      target: { value: '8' },
    });
    expect(onShiftDurationChange).toHaveBeenCalledWith('8');

    expect(screen.getByDisplayValue('2026-08-29T09:00')).toHaveAttribute('name', 'start');
    expect(screen.getByDisplayValue('2026-09-29T09:00')).toHaveAttribute('name', 'end');
  });
});
