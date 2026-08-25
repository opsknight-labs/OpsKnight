import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendIncidentWhatsApp, sendWhatsApp } from '@/lib/whatsapp';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: () => 'https://test.example.com',
}));

vi.mock('@/lib/notification-providers', () => ({
  getWhatsAppConfig: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Twilio
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

describe('WhatsApp Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendIncidentWhatsApp', () => {
    it('should send WhatsApp notification with template', async () => {
      const prisma = (await import('@/lib/prisma')).default;
      const { getWhatsAppConfig } = await import('@/lib/notification-providers');

      // Mock user
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+1234567890',
        name: 'John Doe',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Mock incident
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-1',
        title: 'Database Outage',
        service: { name: 'API Service' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Mock WhatsApp config
      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        enabled: true,
        provider: 'twilio',
        accountSid: 'TEST_SID',
        authToken: 'TEST_TOKEN',
        whatsappNumber: '+1234567890',
        whatsappContentSid: 'HX1234',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const twilioMock = (await import('twilio')).default;
      const mockCreate = vi.fn().mockResolvedValue({ sid: 'MSG123' });
      vi.mocked(twilioMock).mockReturnValue({
        messages: { create: mockCreate },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendIncidentWhatsApp('user-1', 'inc-1', 'triggered');

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          contentSid: 'HX1234',
          to: 'whatsapp:+1234567890',
          from: 'whatsapp:+1234567890',
        })
      );
    });

    it('should return error when user has no phone number', async () => {
      const prisma = (await import('@/lib/prisma')).default;
      const { getWhatsAppConfig } = await import('@/lib/notification-providers');

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        phoneNumber: null,
        name: 'John Doe',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-1',
        title: 'Test',
        service: { name: 'Test' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        enabled: true,
        provider: 'twilio',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendIncidentWhatsApp('user-1', 'inc-1', 'triggered');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no phone number');
    });

    it('should return error when WhatsApp not enabled', async () => {
      const prisma = (await import('@/lib/prisma')).default;
      const { getWhatsAppConfig } = await import('@/lib/notification-providers');

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        phoneNumber: '+1234567890',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-1',
        title: 'Test',
        service: { name: 'Test' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        enabled: false,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendIncidentWhatsApp('user-1', 'inc-1', 'triggered');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured or enabled');
    });

    it('should reject country-less phone numbers', async () => {
      const prisma = (await import('@/lib/prisma')).default;
      const { getWhatsAppConfig } = await import('@/lib/notification-providers');

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        phoneNumber: '5551234567', // US number without +1
        name: 'Test User',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-1',
        title: 'Test',
        service: { name: 'Test' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        enabled: true,
        provider: 'twilio',
        accountSid: 'TEST_SID',
        authToken: 'TEST_TOKEN',
        whatsappNumber: '+1234567890',
        whatsappContentSid: 'HX1234',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const twilioMock = (await import('twilio')).default;
      const mockCreate = vi.fn().mockResolvedValue({ sid: 'MSG123' });
      vi.mocked(twilioMock).mockReturnValue({
        messages: { create: mockCreate },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendIncidentWhatsApp('user-1', 'inc-1', 'triggered');
      expect(result.success).toBe(false);
      expect(result.error).toContain('country code');
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('sendWhatsApp', () => {
    it('should send generic WhatsApp message', async () => {
      const { getWhatsAppConfig } = await import('@/lib/notification-providers');

      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        enabled: true,
        provider: 'twilio',
        accountSid: 'TEST_SID',
        authToken: 'TEST_TOKEN',
        whatsappNumber: '+1234567890',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const twilioMock = (await import('twilio')).default;
      const mockCreate = vi.fn().mockResolvedValue({ sid: 'MSG456' });
      vi.mocked(twilioMock).mockReturnValue({
        messages: { create: mockCreate },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await sendWhatsApp('+1234567890', 'Test message');

      expect(result.success).toBe(true);
      expect(result.messageSid).toBe('MSG456');
    });
  });
});
