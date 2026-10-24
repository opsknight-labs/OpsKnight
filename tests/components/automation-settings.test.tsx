import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/app/(app)/settings/system/automation-actions', () => ({
  saveAutomationSettings: mocks.save,
}));

import AutomationSettings from '@/components/settings/AutomationSettings';

const initial = {
  automationEnabled: true,
  automationTraceRetentionDays: 30,
  automationSettingsRevision: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockImplementation(async (input: Record<string, unknown>) => ({
    ok: true,
    settings: {
      automationEnabled: input.automationEnabled,
      automationTraceRetentionDays: input.automationTraceRetentionDays,
      automationSettingsRevision: 5,
    },
  }));
});

const retention = () => screen.getByLabelText('Trace and observation retention (days)');
const save = () => screen.getByRole('button', { name: 'Save automation settings' });

describe('AutomationSettings', () => {
  it('saves with the expected revision and announces success in a live status region', async () => {
    render(<AutomationSettings initialSettings={initial} />);
    expect(screen.getByRole('region', { name: 'Global automation settings' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.change(retention(), { target: { value: '120' } });
    fireEvent.click(save());
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Automation settings saved.')
    );
    expect(mocks.save).toHaveBeenCalledWith({
      automationEnabled: true,
      automationTraceRetentionDays: 120,
      expectedRevision: 4,
    });
    fireEvent.change(retention(), { target: { value: '90' } });
    fireEvent.click(save());
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toMatchObject({ expectedRevision: 5 });
  });

  it.each([
    ['', 'Enter a retention period in days.'],
    ['0', 'Enter a value from 1 to 3650 days.'],
    ['3651', 'Enter a value from 1 to 3650 days.'],
    ['1.5', 'Enter a whole number of days.'],
  ])('blocks saving invalid retention %j with an inline error', (value, message) => {
    render(<AutomationSettings initialSettings={initial} />);
    fireEvent.change(retention(), { target: { value } });
    fireEvent.click(save());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toBeTruthy();
    expect(retention().getAttribute('aria-invalid')).toBe('true');
    expect(retention().getAttribute('aria-describedby')).toContain(screen.getByText(message).id);
  });

  it('asks for confirmation before turning automation off and explains the consequences', async () => {
    render(<AutomationSettings initialSettings={initial} />);
    const toggle = screen.getByLabelText('Enable service automation globally');
    expect(toggle.getAttribute('role')).toBe('switch');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/reset every service in Shadow or Live to\s+Disabled/)).toBeTruthy();

    fireEvent.click(save());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Every service in Shadow or Live is reset to Disabled.');
    expect(dialog.textContent).toContain('Routing decisions already pinned to incidents are kept.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep automation on' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.save).not.toHaveBeenCalled();

    fireEvent.click(save());
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off automation' }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        automationEnabled: false,
        automationTraceRetentionDays: 30,
        expectedRevision: 4,
      })
    );
  });

  it('does not ask for confirmation when enabling automation', async () => {
    render(<AutomationSettings initialSettings={{ ...initial, automationEnabled: false }} />);
    fireEvent.click(screen.getByLabelText('Enable service automation globally'));
    fireEvent.click(save());
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ automationEnabled: true });
  });

  it('explains an optimistic-concurrency conflict and offers a reload', async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      message:
        'Another administrator changed these settings. Reload to see the latest values, then save again.',
    });
    render(<AutomationSettings initialSettings={initial} />);
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Another administrator changed these settings.');
    expect(screen.getByRole('button', { name: 'Reload settings' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the active-services guard message verbatim without a reload action', async () => {
    const message =
      'Services are already configured SHADOW or LIVE. Save global OFF to reset their modes before enabling; then activate services individually.';
    mocks.save.mockResolvedValue({ ok: false, code: 'ACTIVE_SERVICES', message });
    render(<AutomationSettings initialSettings={{ ...initial, automationEnabled: false }} />);
    fireEvent.click(screen.getByLabelText('Enable service automation globally'));
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: 'Reload settings' })).toBeNull();
    expect(
      screen.getByLabelText('Enable service automation globally').getAttribute('aria-checked')
    ).toBe('true');
  });

  it('maps server field errors to the retention input and clears them on edit', async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      message: 'Check the highlighted settings and try again.',
      fieldErrors: { automationTraceRetentionDays: 'Enter a whole number of days from 1 to 3650.' },
    });
    render(<AutomationSettings initialSettings={initial} />);
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Check the highlighted settings and try again.'
    );
    const fieldError = screen.getByText('Enter a whole number of days from 1 to 3650.');
    expect(retention().getAttribute('aria-invalid')).toBe('true');
    expect(retention().getAttribute('aria-describedby')).toContain(fieldError.id);
    await waitFor(() => expect(document.activeElement).toBe(retention()));
    expect(screen.queryByRole('button', { name: 'Reload settings' })).toBeNull();
    fireEvent.change(retention(), { target: { value: '45' } });
    expect(screen.queryByText('Enter a whole number of days from 1 to 3650.')).toBeNull();
    expect(retention().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the forbidden message without a reload action', async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Administrator access is required to change automation settings.',
    });
    render(<AutomationSettings initialSettings={initial} />);
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Administrator access is required to change automation settings.'
    );
    expect(screen.queryByRole('button', { name: 'Reload settings' })).toBeNull();
  });

  it('falls back to a generic message with reload when the action throws unexpectedly', async () => {
    mocks.save.mockRejectedValue(new Error('An error occurred in the Server Components render.'));
    render(<AutomationSettings initialSettings={initial} />);
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not save automation settings.');
    expect(alert.textContent).not.toContain('Server Components');
    expect(screen.getByRole('button', { name: 'Reload settings' })).toBeTruthy();
  });
});
