import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationHistory from '@/components/settings/NotificationHistory';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const row = {
  id: 'n-1',
  channel: 'EMAIL',
  status: 'SENT',
  message: null,
  incident: { id: 'i-1', title: '=HYPERLINK("http://evil","x")', status: 'OPEN', urgency: 'HIGH' },
  sentAt: '2026-01-01T00:00:00.000Z',
  deliveredAt: null,
  failedAt: null,
  errorMsg: '@SUM(1)',
  attempts: 1,
  latencyMs: 12,
  pendingForMs: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('NotificationHistory CSV export', () => {
  let csv = '';

  beforeEach(() => {
    csv = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ notifications: [row], total: 1 }),
      })
    );
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          csv = parts.join('');
        }
      }
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('neutralises formulas in incident titles and error text', async () => {
    render(<NotificationHistory />);
    const button = await screen.findByRole('button', { name: /export csv/i });
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    await waitFor(() => expect(csv).not.toBe(''));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).toContain(`"'@SUM(1)"`);
    expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
  });
});
