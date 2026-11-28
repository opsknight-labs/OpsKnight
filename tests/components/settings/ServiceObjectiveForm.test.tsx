import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/settings/service-objectives/actions', () => ({ saveObjective: vi.fn() }));
vi.mock('@/components/runbooks/SearchableRunbookSelect', () => ({
  SearchableRunbookSelect: () => null,
}));
vi.mock('@/components/settings/SloAlertingStep', () => ({ SloAlertingStep: () => null }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { ServiceObjectiveForm } from '@/components/settings/ServiceObjectiveForm';

function comparatorValue(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[name="comparator"]')?.value;
}

describe('ServiceObjectiveForm', () => {
  it('follows the measurement: percent is at least, minutes is at most', () => {
    const { container } = render(<ServiceObjectiveForm />);
    const target = () => container.querySelector<HTMLInputElement>('input[name="target"]')!;

    expect(comparatorValue(container)).toBe('GREATER_THAN_OR_EQUAL');
    expect(target().value).toBe('99.9');

    fireEvent.change(screen.getByLabelText('Measurement'), { target: { value: 'MTTA' } });

    expect(comparatorValue(container)).toBe('LESS_THAN_OR_EQUAL');
    expect(target().value).toBe('');

    fireEvent.change(screen.getByLabelText('Measurement'), { target: { value: 'AVAILABILITY' } });

    expect(comparatorValue(container)).toBe('GREATER_THAN_OR_EQUAL');
    expect(target().value).toBe('99.9');
  });

  it('keeps an edited objective on the direction of its own measurement', () => {
    const { container } = render(
      <ServiceObjectiveForm
        objective={{
          id: 'so_1',
          version: 2,
          name: 'MTTR goal',
          description: null,
          metricType: 'MTTR',
          target: 60,
          comparator: 'LESS_THAN_OR_EQUAL',
          windowType: 'THIRTY_DAYS',
          windowValue: null,
        }}
      />
    );

    expect(comparatorValue(container)).toBe('LESS_THAN_OR_EQUAL');
  });
});
