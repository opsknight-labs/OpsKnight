import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import ProviderCard from '@/components/settings/ProviderCard';
import NotificationProviderSettingsPage from '@/app/(app)/settings/notifications/page';
import type { ProviderRecord } from '@/types/notification-types';

const testProviderMock = vi.fn();
const updateProviderMock = vi.fn();
const mockPermissions = { isAdmin: true };

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => mockPermissions),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  redirect: vi.fn(),
}));

let mockProvidersList: ProviderRecord[] = [];

vi.mock('@/app/(app)/settings/system/actions', () => ({
  getNotificationProviders: vi.fn(async () => mockProvidersList),
  updateNotificationProvider: vi.fn((...args) => updateProviderMock(...args)),
  testNotificationProvider: vi.fn((...args) => testProviderMock(...args)),
  generateVapidKeys: vi.fn().mockResolvedValue({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
    subject: 'mailto:admin@example.com',
  }),
}));

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Notification Provider Settings UI & Hero Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. AWS SNS Integration in SMS Section', () => {
    it('renders Amazon SNS in the SMS Messaging section alongside Twilio', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: true,
          config: {
            accountSid: 'AC1234567890',
            authToken: 'secret_token',
            fromNumber: '+1234567890',
          },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-sns',
          provider: 'aws-sns',
          enabled: false,
          config: {},
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      expect(screen.getByText('SMS Messaging')).toBeDefined();
      expect(screen.getByText('Twilio (SMS)')).toBeDefined();
      expect(screen.getByText('Amazon SNS (SMS)')).toBeDefined();
    });

    it('expands AWS SNS card and displays AWS credential fields', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-sns',
          provider: 'aws-sns',
          enabled: false,
          config: {
            region: 'us-east-1',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      const configureSnsBtn = screen.getByRole('button', { name: /Configure Amazon SNS/i });
      fireEvent.click(configureSnsBtn);

      expect(screen.getByLabelText(/AWS Region/i)).toBeDefined();
      expect(screen.getByLabelText(/Access Key ID/i)).toBeDefined();
      expect(screen.getByPlaceholderText(/Your AWS secret access key/i)).toBeDefined();
    });
  });

  describe('2. SMS Channel Availability with SNS-Only Setup', () => {
    it('counts SMS channel as active when Twilio is disabled but AWS SNS is active', async () => {
      mockProvidersList = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: false,
          config: {},
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-sns',
          provider: 'aws-sns',
          enabled: true,
          config: {
            region: 'us-east-1',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      const jsx = await NotificationProviderSettingsPage();
      render(jsx);

      // Hero banner badge should indicate at least 1 channel is available
      expect(screen.getByText(/1\/4 Channels Available/i)).toBeDefined();
      // SMS Provider runtime card shows Amazon SNS
      expect(screen.getByText('Amazon SNS')).toBeDefined();
    });
  });

  describe('3. Twilio SMS OFF + WhatsApp ON', () => {
    it('renders Twilio as Standby and WhatsApp as Active & Routing', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: false, // Twilio SMS disabled
          config: {
            accountSid: 'AC1234567890',
            authToken: 'secret_token',
            fromNumber: '+1234567890',
            whatsappEnabled: true,
            whatsappNumber: 'whatsapp:+14155238886',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      // WhatsApp section shows Active & Routing
      expect(screen.getByText('WhatsApp Business Messaging')).toBeDefined();
      expect(screen.getByText('Active & Routing')).toBeDefined();
      // Twilio SMS is configured but standby
      expect(screen.getByText('Configured (Standby)')).toBeDefined();
    });
  });

  describe('4. WhatsApp Credential Validation', () => {
    it('cannot show Active when whatsappNumber is missing despite whatsappEnabled: true', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: true,
          config: {
            accountSid: 'AC1234567890',
            authToken: 'secret_token',
            fromNumber: '+1234567890',
            whatsappEnabled: true,
            whatsappNumber: '', // missing number
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      // WhatsApp card must show Setup Required, not Active
      const setupBadges = screen.getAllByText('Setup Required');
      expect(setupBadges.length).toBeGreaterThan(0);
    });

    it('cannot show Active when credentials are encrypted or missing', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: true,
          config: {
            accountSid: 'enc:corrupted-key',
            authToken: 'enc:corrupted-token',
            whatsappEnabled: true,
            whatsappNumber: 'whatsapp:+14155238886',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      // Corrupt Twilio should show Configuration Error
      expect(screen.getAllByText('Configuration Error').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. Corrupt Encrypted Provider Handling', () => {
    it('shows Configuration Error badge for corrupt ciphertext instead of Active & Routing', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-resend',
          provider: 'resend',
          enabled: true,
          config: {
            apiKey: 'enc:corrupted-ciphertext',
            fromEmail: 'alerts@example.com',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      expect(screen.getByText('Configuration Error')).toBeDefined();
      expect(screen.queryByText('Active & Routing')).toBeNull();
      expect(screen.queryByText('Primary (Active)')).toBeNull();
    });
  });

  describe('6. Email Route Ordering Badges', () => {
    it('renders Primary, Fallback #1, and Fallback #2 in configured route order', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-resend',
          provider: 'resend',
          enabled: true,
          config: { apiKey: 're_123', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-sendgrid',
          provider: 'sendgrid',
          enabled: true,
          config: { apiKey: 'sg_123', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-ses',
          provider: 'ses',
          enabled: true,
          config: { accessKeyId: 'ses_key', secretAccessKey: 'ses_sec', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-smtp',
          provider: 'smtp',
          enabled: false,
          config: {},
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      expect(screen.getByText('Primary (Active)')).toBeDefined();
      expect(screen.getByText('Fallback #1')).toBeDefined();
      expect(screen.getByText('Fallback #2')).toBeDefined();
      expect(screen.getAllByText('Setup Required').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('7. Effective SMS Provider Resolution', () => {
    it('marks Twilio as Active and AWS SNS as Standby when both are enabled', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: true,
          config: { accountSid: 'AC123', authToken: 'auth123', fromNumber: '+1234567890' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-sns',
          provider: 'aws-sns',
          enabled: true,
          config: { accessKeyId: 'AKIA123', secretAccessKey: 'sec123' },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      // Twilio is Primary / Active, AWS SNS is Standby
      expect(screen.getByText('Active & Routing')).toBeDefined();
      expect(screen.getByText('Configured (Standby)')).toBeDefined();
    });
  });

  describe('8. Standby Badges for Configured but Disabled Providers', () => {
    it('displays Configured (Standby) for a fully configured provider with enabled: false', () => {
      const providers: ProviderRecord[] = [
        {
          id: 'prov-resend',
          provider: 'resend',
          enabled: false,
          config: { apiKey: 're_valid_key', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
      ];

      render(<SystemNotificationSettings providers={providers} />);

      expect(screen.getByText('Configured (Standby)')).toBeDefined();
    });
  });

  describe('9. Send Test Button Status', () => {
    it('displays "Accepted" (not "Delivered" or "Sent!") when test returns ACCEPTED', async () => {
      testProviderMock.mockResolvedValueOnce({
        status: 'ACCEPTED',
        message: 'Message accepted by Resend',
        provider: 'resend',
        providerMessageId: 'msg-accepted-123',
        notificationId: 'notif-123',
      });

      render(
        <ProviderCard
          providerConfig={{
            key: 'resend',
            name: 'Resend',
            description: 'Email provider',
            fields: [
              { name: 'apiKey', label: 'API Key', type: 'password', required: true },
              { name: 'fromEmail', label: 'From Email', type: 'text', required: true },
            ],
          }}
          existing={{
            id: 'prov-resend',
            provider: 'resend',
            enabled: true,
            config: { apiKey: 're_123', fromEmail: 'alerts@opsknight.com' },
            updatedAt: new Date().toISOString(),
          }}
          isExpanded={false}
          onToggle={vi.fn()}
          statusRole="primary"
        />
      );

      const testBtn = screen.getByRole('button', { name: /Send test notification via Resend/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(screen.getByText('Accepted')).toBeDefined();
      });
      expect(screen.queryByText('Delivered')).toBeNull();
      expect(screen.queryByText('Sent!')).toBeNull();
    });
  });

  describe('10. Inline Test Result Rendering for All Statuses', () => {
    const renderCardWithTestResult = async (status: string, extra?: Record<string, unknown>) => {
      testProviderMock.mockResolvedValueOnce({
        status,
        message: `Status message for ${status}`,
        provider: 'resend',
        providerMessageId: 'msg-xyz-99',
        notificationId: 'notif-xyz-99',
        ...extra,
      });

      render(
        <ProviderCard
          providerConfig={{
            key: 'resend',
            name: 'Resend',
            description: 'Email provider',
            fields: [
              { name: 'apiKey', label: 'API Key', type: 'password', required: true },
              { name: 'fromEmail', label: 'From Email', type: 'text', required: true },
            ],
          }}
          existing={{
            id: 'prov-resend',
            provider: 'resend',
            enabled: true,
            config: { apiKey: 're_123', fromEmail: 'alerts@opsknight.com' },
            updatedAt: new Date().toISOString(),
          }}
          isExpanded={false}
          onToggle={vi.fn()}
          statusRole="primary"
        />
      );

      const testBtn = screen.getByRole('button', { name: /Send test notification via Resend/i });
      fireEvent.click(testBtn);
    };

    it('renders ACCEPTED state with message ID and timestamp', async () => {
      await renderCardWithTestResult('ACCEPTED');
      await waitFor(() => {
        expect(screen.getByText('Provider Accepted Test')).toBeDefined();
        expect(screen.getByText('msg-xyz-99')).toBeDefined();
      });
    });

    it('renders DELIVERED state', async () => {
      await renderCardWithTestResult('DELIVERED');
      await waitFor(() => {
        expect(screen.getByText('Delivered to Recipient')).toBeDefined();
      });
    });

    it('renders QUEUED state', async () => {
      await renderCardWithTestResult('QUEUED');
      await waitFor(() => {
        expect(screen.getByText('Test Notification Queued')).toBeDefined();
      });
    });

    it('renders DEFERRED state', async () => {
      await renderCardWithTestResult('DEFERRED');
      await waitFor(() => {
        expect(screen.getByText('Delivery Deferred (Rate Limited)')).toBeDefined();
      });
    });

    it('renders UNKNOWN state', async () => {
      await renderCardWithTestResult('UNKNOWN');
      await waitFor(() => {
        expect(screen.getByText('Delivery Status Unconfirmed')).toBeDefined();
      });
    });

    it('renders FAILED state with error details', async () => {
      await renderCardWithTestResult('FAILED', { message: 'Invalid API Key' });
      await waitFor(() => {
        expect(screen.getByText('Test Delivery Failed')).toBeDefined();
        expect(screen.getByText('Invalid API Key')).toBeDefined();
      });
    });
  });

  describe('11. Unsaved Changes Guard Against Testing', () => {
    it('disables Send Test button when form has dirty unsaved changes', () => {
      const { container } = render(
        <ProviderCard
          providerConfig={{
            key: 'resend',
            name: 'Resend',
            description: 'Email provider',
            fields: [
              { name: 'apiKey', label: 'API Key', type: 'password', required: true },
              { name: 'fromEmail', label: 'From Email', type: 'text', required: true },
            ],
          }}
          existing={{
            id: 'prov-resend',
            provider: 'resend',
            enabled: true,
            config: { apiKey: 're_123', fromEmail: 'alerts@opsknight.com' },
            updatedAt: new Date().toISOString(),
          }}
          isExpanded={true}
          onToggle={vi.fn()}
          statusRole="primary"
        />
      );

      const apiKeyInput = container.querySelector('input#apiKey')!;
      expect(apiKeyInput).toBeDefined();
      fireEvent.change(apiKeyInput, { target: { value: 're_different_key' } });

      const testBtn = screen.getByRole('button', { name: /Send test notification via Resend/i });
      expect((testBtn as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('Save first')).toBeDefined();
    });
  });

  describe('12. Single Enable Control per Provider', () => {
    it('has only one switch in header and no inner enable checkbox inside expanded form', () => {
      render(
        <ProviderCard
          providerConfig={{
            key: 'resend',
            name: 'Resend',
            description: 'Email provider',
            fields: [
              { name: 'apiKey', label: 'API Key', type: 'password', required: true },
              { name: 'fromEmail', label: 'From Email', type: 'text', required: true },
            ],
          }}
          existing={{
            id: 'prov-resend',
            provider: 'resend',
            enabled: true,
            config: { apiKey: 're_123', fromEmail: 'alerts@opsknight.com' },
            updatedAt: new Date().toISOString(),
          }}
          isExpanded={true}
          onToggle={vi.fn()}
          statusRole="primary"
        />
      );

      // Verify header toggle switch exists
      const switchEl = screen.getByRole('switch', { name: /Toggle Resend provider/i });
      expect(switchEl).toBeDefined();

      // Verify no inner checkbox exists for enabling the provider
      expect(screen.queryByText(/Enable Resend for outbound alert dispatch/i)).toBeNull();
      expect(screen.queryByRole('checkbox', { name: /Enable Resend/i })).toBeNull();
    });
  });

  describe('13. Hero Banner & Runtime Overview Strip', () => {
    it('renders Outbound Delivery tag, My Delivery History link, and runtime metrics', async () => {
      mockProvidersList = [
        {
          id: 'prov-resend',
          provider: 'resend',
          enabled: true,
          config: { apiKey: 're_123', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-sendgrid',
          provider: 'sendgrid',
          enabled: true,
          config: { apiKey: 'sg_123', fromEmail: 'ops@example.com' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-twilio',
          provider: 'twilio',
          enabled: true,
          config: {
            accountSid: 'AC123',
            authToken: 'auth123',
            fromNumber: '+1234567890',
            whatsappEnabled: true,
            whatsappNumber: 'whatsapp:+14155238886',
          },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prov-push',
          provider: 'web-push',
          enabled: true,
          config: {
            vapidPublicKey: 'BK123',
            vapidPrivateKey: 'priv123',
          },
          updatedAt: new Date().toISOString(),
        },
      ];

      const jsx = await NotificationProviderSettingsPage();
      render(jsx);

      // 1. Hero tag and title
      expect(screen.getAllByText('Outbound Delivery').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Notification Providers')).toBeDefined();

      // 2. Badges: 4/4 Channels Available
      expect(screen.getByText(/4\/4 Channels Available/i)).toBeDefined();

      // 3. Action button: My Delivery History
      const historyLink = screen.getByRole('link', { name: /My Delivery History/i });
      expect(historyLink.getAttribute('href')).toBe('/settings/notifications/history');

      // 4. Runtime overview cards
      expect(screen.getAllByText('Resend → SendGrid').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Twilio').length).toBeGreaterThanOrEqual(1);

      // 5. Hardcoded AES-256 removed
      expect(screen.queryByText(/Vault Storage AES-256/i)).toBeNull();
    });
  });
});
