import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SlackOnCallSyncCard from '@/components/settings/SlackOnCallSyncCard';

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body } as unknown as Response);

describe('SlackOnCallSyncCard', () => {
  const original = global.fetch;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = original;
  });

  it('hides itself instead of crashing the page when the reply is not the expected shape', async () => {
    for (const body of [{}, { channels: [] }, { data: { mappings: 'x' } }, null]) {
      global.fetch = reply(body);
      const { container, unmount } = render(<SlackOnCallSyncCard />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('lists a mapping with the schedule name when the reply is valid', async () => {
    global.fetch = reply({
      data: {
        mappings: [
          {
            scheduleId: 's1',
            usergroupId: 'S0GROUP',
            enabled: true,
            lastSyncedAt: null,
            lastError: null,
          },
        ],
        schedules: [{ id: 's1', name: 'Platform primary' }],
        usergroups: null,
        canWrite: true,
      },
    });
    render(<SlackOnCallSyncCard />);
    expect((await screen.findAllByText('Platform primary')).length).toBeGreaterThan(0);
    expect(screen.getByText(/S0GROUP/)).toBeInTheDocument();
  });
});
