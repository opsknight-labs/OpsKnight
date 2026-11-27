import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ServiceNotificationSettings from '@/components/service/ServiceNotificationSettings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/services/svc-1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(app)/services/actions', () => ({
  updateServiceNotificationSettings: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const slackIntegration = {
  id: 'slack-1',
  workspaceName: 'Acme',
  workspaceId: 'T000',
  enabled: true,
};

const base = {
  serviceId: 'svc-1',
  serviceNotificationChannels: ['SLACK'],
  slackChannel: null,
  slackWebhookConfigured: false,
  slackIntegration,
  webhookIntegrations: [],
  serviceNotifyOnTriggered: true,
  serviceNotifyOnAck: true,
  serviceNotifyOnResolved: true,
  serviceNotifyOnSlaBreach: false,
};

describe('ServiceNotificationSettings', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ channels: [], destinations: [] })))
    );
  });

  it('shows a configured Slack webhook as configured and never puts the URL in the form', () => {
    const { container } = render(
      <ServiceNotificationSettings {...base} slackWebhookConfigured />
    );

    const field = container.querySelector<HTMLInputElement>('input[name="slackWebhookUrl"]');
    expect(field).not.toBeNull();
    expect(field!.value).toBe('');
    expect(field!.placeholder).toMatch(/Configured/);
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(container.querySelector('input[name="clearSlackWebhookUrl"]')).not.toBeNull();
  });

  it('offers no remove box when no webhook is stored', () => {
    const { container } = render(<ServiceNotificationSettings {...base} />);
    expect(container.querySelector('input[name="clearSlackWebhookUrl"]')).toBeNull();
  });

  it('warns about stored channels that never send and leaves them out of the saved list', () => {
    const { container } = render(
      <ServiceNotificationSettings {...base} serviceNotificationChannels={['SLACK', 'EMAIL', 'SMS']} />
    );

    expect(screen.getByText('Some stored channels are never sent')).toBeInTheDocument();
    expect(screen.getByText(/EMAIL, SMS/)).toBeInTheDocument();
    const submitted = container.querySelector<HTMLInputElement>(
      'input[name="serviceNotificationChannelsJson"]'
    );
    expect(JSON.parse(submitted!.value)).toEqual(['SLACK']);
  });
});
