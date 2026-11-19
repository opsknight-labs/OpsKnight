import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncidentCustomFieldsCard from '@/components/incident/detail/IncidentCustomFieldsCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/toast', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

const textField = {
  id: 'cf-ticket',
  name: 'Ticket',
  key: 'ticket',
  type: 'TEXT' as const,
  required: true,
  defaultValue: null,
};

const dateField = {
  id: 'cf-date',
  name: 'Started',
  key: 'started',
  type: 'DATE' as const,
  required: false,
  defaultValue: null,
};

describe('IncidentCustomFieldsCard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('saves a typed text value on blur', async () => {
    render(
      <IncidentCustomFieldsCard
        incidentId="inc-1"
        customFieldValues={[]}
        allCustomFields={[textField]}
        canManage
      />
    );
    const input = screen.getByPlaceholderText('Enter value...');
    fireEvent.change(input, { target: { value: 'INC-42' } });
    fireEvent.blur(input, { target: { value: 'INC-42' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      customFieldId: 'cf-ticket',
      value: 'INC-42',
    });
  });

  it('shows a stored ISO date in the date input and does not erase it on blur', () => {
    const { container } = render(
      <IncidentCustomFieldsCard
        incidentId="inc-1"
        customFieldValues={[
          {
            id: 'v1',
            value: '2026-01-05T00:00:00.000Z',
            customField: dateField,
          },
        ]}
        allCustomFields={[dateField]}
        canManage
      />
    );
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(input.value).toBe('2026-01-05');
    fireEvent.blur(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
