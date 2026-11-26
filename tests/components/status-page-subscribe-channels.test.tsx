import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StatusPageSubscribe from '@/components/status-page/StatusPageSubscribe';

const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) }) as unknown as Response;

describe('StatusPageSubscribe channels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers one tab per enabled channel and only email without slug routes', () => {
    const { unmount } = render(
      <StatusPageSubscribe
        statusPageId="p1"
        subscribeSlug="acme"
        channels={['EMAIL', 'SLACK', 'MICROSOFT_TEAMS', 'SMS']}
      />
    );
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Email',
      'Slack',
      'Teams',
      'SMS',
    ]);
    unmount();
    render(
      <StatusPageSubscribe statusPageId="p1" subscribeSlug={null} channels={['EMAIL', 'SMS']} />
    );
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
  });

  it('subscribes by SMS in two steps: number, then code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ pending: true }))
      .mockResolvedValueOnce(ok({ subscribed: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StatusPageSubscribe statusPageId="p1" subscribeSlug="acme" channels={['EMAIL', 'SMS']} />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'SMS' }));
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '+14155550100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/status/acme/subscribe/sms');
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByText('Text updates on')).toBeTruthy());
    expect(fetchMock.mock.calls[1][0]).toBe('/api/status/acme/subscribe/sms/verify');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      phone: '+14155550100',
      code: '123456',
    });
  });

  it('subscribes a Slack webhook with the picked services and shows the server error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'The webhook did not accept a test message.' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StatusPageSubscribe
        statusPageId="p1"
        subscribeSlug="acme"
        channels={['SLACK']}
        services={[{ id: 's1', name: 'API' }]}
        initialSelectedId="s1"
      />
    );
    fireEvent.change(screen.getByLabelText('Slack incoming-webhook URL'), {
      target: { value: 'https://hooks.slack.com/services/T/B/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('did not accept a test message')
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      channel: 'SLACK',
      url: 'https://hooks.slack.com/services/T/B/x',
      preferences: { selectedServiceIds: ['s1'] },
    });
  });
});
