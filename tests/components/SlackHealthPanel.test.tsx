import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  SlackHealthPanel,
  SlackScopeHealthNotice,
} from '@/components/settings/slack/SlackHealthPanel';
import { SLACK_BOT_SCOPES, SLACK_REQUIRED_BOT_SCOPES } from '@/lib/slack/app-manifest';
import { buildSlackHealthReport } from '@/lib/slack/health';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const BASE = 'https://ok.example.com';

describe('SlackScopeHealthNotice', () => {
  it('renders nothing when every scope is granted', () => {
    const { container } = render(
      <SlackScopeHealthNotice scopes={[...SLACK_BOT_SCOPES]} baseUrl={BASE} isAdmin onReconnect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the manifest-out-of-date warning with features and actions for optional gaps', () => {
    const onReconnect = vi.fn();
    render(
      <SlackScopeHealthNotice
        scopes={[...SLACK_REQUIRED_BOT_SCOPES]}
        baseUrl={BASE}
        isAdmin
        onReconnect={onReconnect}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Slack app manifest out of date');
    expect(screen.getByText('im:write')).toBeInTheDocument();
    expect(screen.getByText('Page responders with a Slack direct message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reconnect Slack/ }));
    expect(onReconnect).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Copy manifest/ })).toBeInTheDocument();
  });

  it('raises an alert for missing required scopes and hides Reconnect from non-admins', () => {
    render(
      <SlackScopeHealthNotice scopes={['chat:write']} baseUrl={BASE} isAdmin={false} onReconnect={vi.fn()} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Missing required Slack scopes');
    expect(screen.getByText('commands')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument();
  });
});

describe('SlackHealthPanel', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ticks steps from live health and lists failing checks', async () => {
    const report = buildSlackHealthReport({
      auth: { ok: true, team: 'Acme', teamId: 'T1' },
      scopes: [...SLACK_BOT_SCOPES],
      signingSecretConfigured: true,
      lastInboundAt: null,
      squireChatEnabled: false,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ...report, workspaceName: 'Acme' } }), {
        status: 200,
      })
    );

    render(<SlackHealthPanel baseUrl={BASE} testSent={false} />);

    await waitFor(() => expect(screen.getByText(/2 of 5 done/)).toBeInTheDocument());
    expect(screen.getByText(/Install OpsKnight to your workspace/)).toHaveTextContent('(done)');
    expect(screen.getByText(/Verify events and interactivity/)).toHaveTextContent('(to do)');
    expect(screen.getByRole('button', { name: 'Copy Events URL' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Intelligence settings' })).toHaveAttribute(
      'href',
      '/settings/intelligence/ai'
    );
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('shows the server error when the check fails', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized. Admin access required.' }), { status: 403 })
    );
    render(<SlackHealthPanel baseUrl={BASE} testSent={false} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Unauthorized. Admin access required.')
    );
  });
});
