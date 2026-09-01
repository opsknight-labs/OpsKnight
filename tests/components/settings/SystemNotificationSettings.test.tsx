import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import type { ProviderRecord } from '@/types/notification-types';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/app/(app)/settings/system/actions', () => ({
  updateNotificationProvider: vi.fn(),
  generateVapidKeys: vi.fn().mockResolvedValue({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
    subject: 'mailto:admin@example.com',
  }),
}));

const mockProviders: ProviderRecord[] = [
  {
    id: 'prov-1',
    provider: 'twilio',
    enabled: true,
    config: {
      accountSid: 'AC1234567890',
      authToken: 'secret_token',
      fromNumber: '+1234567890',
      whatsappEnabled: true,
      whatsappNumber: 'whatsapp:+14155238886',
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prov-2',
    provider: 'resend',
    enabled: true,
    config: {
      apiKey: 're_12345',
      fromEmail: 'alerts@opsknight.com',
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prov-3',
    provider: 'web-push',
    enabled: false,
    config: {},
    updatedAt: new Date().toISOString(),
  },
];

describe('SystemNotificationSettings Component', () => {
  it('renders all categorized notification gateway sections', () => {
    render(<SystemNotificationSettings providers={mockProviders} />);

    expect(screen.getByText('SMS & Telephony')).toBeDefined();
    expect(screen.getByText('WhatsApp Business Messaging')).toBeDefined();
    expect(screen.getByText('Transactional Email Gateways')).toBeDefined();
    expect(screen.getByText('Native Browser Push (PWA)')).toBeDefined();
  });

  it('displays active badges for enabled channels', () => {
    render(<SystemNotificationSettings providers={mockProviders} />);

    // Twilio (SMS), WhatsApp, and Resend should have Active & Routing badges
    const activeBadges = screen.getAllByText('Active & Routing');
    expect(activeBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('expands a provider card when Configure is clicked', async () => {
    render(<SystemNotificationSettings providers={mockProviders} />);

    const configureButtons = screen.getAllByRole('button', { name: /Configure/i });
    expect(configureButtons.length).toBeGreaterThan(0);

    fireEvent.click(configureButtons[0]);
    expect(screen.getByText(/Collapse/i)).toBeDefined();
  });
});
