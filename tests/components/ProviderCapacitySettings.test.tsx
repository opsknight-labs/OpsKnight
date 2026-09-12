import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderCapacitySettings from '@/components/settings/ProviderCapacitySettings';

function mockCapacityResponse(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    bulkPaused: false,
    providerCapacities: [
      {
        provider: 'twilio',
        channel: 'SMS',
        mode: 'CUSTOM',
        ratePerSecond: 50,
        maxInFlight: 10,
        bulkSharePercent: 80,
        adaptiveBackpressure: true,
        revision: 3,
        updatedAt: new Date().toISOString(),
      },
    ],
    hardLimits: {
      ratePerSecond: { min: 1, max: 10000 },
      maxInFlight: { min: 1, max: 5000 },
      bulkSharePercent: { min: 5, max: 95 },
    },
    ...overrides,
  };
  return base;
}

describe('ProviderCapacitySettings — nested-form regression', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('save capacity does not submit the enclosing ProviderCard form (type="button")', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockCapacityResponse()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    // second fetch is refresh after save
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockCapacityResponse({ providerCapacities: [] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const onFormSubmit = vi.fn(e => e.preventDefault());
    const { container } = render(
      <form onSubmit={onFormSubmit}>
        <ProviderCapacitySettings providerKey="twilio" />
      </form>
    );

    await waitFor(() => expect(screen.getByText(/Delivery Capacity/)).toBeInTheDocument());

    const saveButton = screen.getByRole('button', { name: /Save capacity/ });
    // Regression: without type="button", clicking Save would bubble as form submit
    expect(saveButton.getAttribute('type')).toBe('button');

    // Change bulk share to make isDirty true so button is enabled
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement | null;
    expect(slider).toBeTruthy();
    if (slider) fireEvent.change(slider, { target: { value: '75' } });

    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.click(saveButton);

    // The outer form's onSubmit must not have been invoked by the inner save button
    expect(onFormSubmit).not.toHaveBeenCalled();
  });

  it('all actionable buttons inside the capacity card are type="button"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockCapacityResponse()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const { container } = render(<ProviderCapacitySettings providerKey="twilio" />);

    await waitFor(() => expect(screen.getByText(/Delivery Capacity/)).toBeInTheDocument());

    const buttons = Array.from(container.querySelectorAll('button'));
    // Every button in this card that is not submitting the outer form must be type="button"
    for (const btn of buttons) {
      // auto/mode selectors and Save/Cancel/Confirm are all inside this component
      expect(btn.getAttribute('type')).toBe('button');
    }
  });
});
