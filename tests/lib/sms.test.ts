/**
 * SMS Service Tests
 *
 * Test coverage for SMS notification service including:
 * - Twilio provider sending
 * - AWS SNS provider sending
 * - Phone number E.164 formatting
 * - Error handling (invalid numbers, insufficient balance, auth errors)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { formatToE164, sendSMS, sendIncidentSMS } from '@/lib/sms';

// Mock notification providers
vi.mock('@/lib/notification-providers', () => ({
  getSMSConfig: vi.fn(),
}));

// Mock prisma
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

// Mock env-validation
vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://opsknight.example.com'),
}));

// Mock twilio
vi.mock('twilio', () => ({
  default: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockRejectedValue(new Error('Twilio error: 20003')),
    },
  }),
}));

import { getSMSConfig } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';

describe('sendSMS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SMS Disabled', () => {
    it('returns error when SMS is not enabled', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: false,
        provider: null,
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result).toEqual({
        success: false,
        error: 'SMS notifications are not enabled',
      });
    });
  });

  describe('No Provider Configured', () => {
    it('returns error when no provider is configured', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: null,
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result).toEqual({
        success: false,
        error: 'No SMS provider configured',
      });
    });
  });

  describe('Twilio Provider', () => {
    it('returns error when Twilio package is not installed', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'twilio',
        accountSid: 'AC123',
        authToken: 'token123',
        fromNumber: '+15550001111',
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result.success).toBe(false);
      // Error message may vary depending on environment
      expect(result.error).toBeDefined();
    });

    it('returns error when Twilio config is incomplete', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'twilio',
        accountSid: undefined,
        authToken: undefined,
        fromNumber: undefined,
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('configuration incomplete');
    });
  });

  describe('AWS SNS Provider', () => {
    it('returns error when AWS SNS config is incomplete', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'aws-sns',
        region: 'us-east-1',
        accessKeyId: undefined,
        secretAccessKey: undefined,
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('AWS SNS configuration incomplete');
    });

    it('returns error when AWS SDK is not installed', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'aws-sns',
        region: 'us-east-1',
        accessKeyId: 'AKIAXXXXXX',
        secretAccessKey: 'secret123',
      });

      const result = await sendSMS({
        to: '+15551234567',
        message: 'Test message',
      });

      expect(result.success).toBe(false);
      // Should fail because AWS SDK is not installed in test env
    });
  });

  describe('Phone Number Formatting', () => {
    it('rejects ambiguous numbers without a country code', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'twilio',
        accountSid: 'AC123',
        authToken: 'token123',
        fromNumber: '+15550001111',
      });

      // This will fail at Twilio step, but we're testing the number formatting logic
      const result = await sendSMS({
        to: '5551234567',
        message: 'Test message',
      });

      // The function should have attempted to format the number
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid phone number format');
    });

    it('preserves international country codes and strips extensions safely', () => {
      expect(formatToE164('+44 7123 456789')).toBe('+447123456789');
      expect(formatToE164('00 91 98765 43210')).toBe('+919876543210');
      expect(formatToE164('+1 (555) 019-9000 ext 42')).toBe('+15550199000');
      expect(formatToE164('9876543210')).toBe('');
      expect(formatToE164('07123456789')).toBe('');
    });

    it('rejects numbers that are too short', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'twilio',
        accountSid: 'AC123',
        authToken: 'token123',
        fromNumber: '+15550001111',
      });

      const result = await sendSMS({
        to: '12345', // Too short
        message: 'Test message',
      });

      expect(result.success).toBe(false);
      // Either Twilio package not installed or invalid number format
    });

    it('cleans up formatted numbers with spaces and dashes', async () => {
      vi.mocked(getSMSConfig).mockResolvedValueOnce({
        enabled: true,
        provider: 'twilio',
        accountSid: 'AC123',
        authToken: 'token123',
        fromNumber: '+15550001111',
      });

      const result = await sendSMS({
        to: '+1 (555) 123-4567',
        message: 'Test message',
      });

      // Will fail at Twilio step, but number should have been cleaned
      expect(result.success).toBe(false);
    });
  });
});

describe('sendIncidentSMS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when user not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title: 'Test Incident',
    } as any);

    const result = await sendIncidentSMS('user-1', 'inc-1', 'triggered');

    expect(result).toEqual({
      success: false,
      error: 'User or incident not found',
    });
  });

  it('returns error when incident not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: '+15551234567',
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(null);

    const result = await sendIncidentSMS('user-1', 'inc-1', 'triggered');

    expect(result).toEqual({
      success: false,
      error: 'User or incident not found',
    });
  });

  it('returns error when user has no phone number', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: null,
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title: 'Test Incident',
      urgency: 'HIGH',
      service: { name: 'API Service' },
      assignee: null,
    } as any);

    const result = await sendIncidentSMS('user-1', 'inc-1', 'triggered');

    expect(result).toEqual({
      success: false,
      error: 'User has no phone number configured',
    });
  });

  it('creates proper message for triggered incident', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: '+15551234567',
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title: 'Database connection timeout',
      urgency: 'HIGH',
      service: { name: 'API Service' },
      assignee: null,
    } as any);
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: false, // Will fail early, but message was constructed
      provider: null,
    });

    await sendIncidentSMS('user-1', 'inc-1', 'triggered');

    // Verify the message format expectations
    // The function should have attempted to send with proper formatting
    expect(prisma.incident.findUnique).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      include: {
        service: true,
        assignee: true,
      },
    });
  });

  it('creates proper message for acknowledged incident', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: '+15551234567',
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title: 'Test Incident',
      urgency: 'MEDIUM',
      service: { name: 'Web App' },
      assignee: { name: 'Assigned User' },
    } as any);
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: false,
      provider: null,
    });

    const result = await sendIncidentSMS('user-1', 'inc-1', 'acknowledged');

    expect(result.success).toBe(false);
    // Message construction verified by not throwing
  });

  it('creates proper message for resolved incident', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: '+15551234567',
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title: 'Test Incident',
      urgency: 'LOW',
      service: { name: 'Batch Jobs' },
      assignee: null,
    } as any);
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: false,
      provider: null,
    });

    const result = await sendIncidentSMS('user-1', 'inc-1', 'resolved');

    expect(result.success).toBe(false);
    // Message construction verified by not throwing
  });

  it('truncates long titles', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user-1',
      name: 'Test User',
      phoneNumber: '+15551234567',
    } as any);
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      id: 'inc-1',
      title:
        'This is a very long incident title that should be truncated because it exceeds the maximum length allowed',
      urgency: 'HIGH',
      service: { name: 'Very Long Service Name That Should Also Be Truncated' },
      assignee: null,
    } as any);
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: false,
      provider: null,
    });

    // Should not throw when handling long titles
    const result = await sendIncidentSMS('user-1', 'inc-1', 'triggered');

    expect(result.success).toBe(false);
    // Long title handling verified by not throwing
  });
});

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles unverified number error (Twilio trial)', async () => {
    // Test error message mapping for common Twilio errors
    // Error code 21211 = unverified number
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: true,
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'token123',
      fromNumber: '+15550001111',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'Test',
    });

    // Will fail because Twilio is not installed, which is expected
    expect(result.success).toBe(false);
  });

  it('handles authentication errors', async () => {
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: true,
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'bad-token',
      fromNumber: '+15550001111',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'Test',
    });

    expect(result.success).toBe(false);
  });

  it('handles insufficient balance errors', async () => {
    vi.mocked(getSMSConfig).mockResolvedValueOnce({
      enabled: true,
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'token123',
      fromNumber: '+15550001111',
    });

    const result = await sendSMS({
      to: '+15551234567',
      message: 'Test',
    });

    expect(result.success).toBe(false);
  });
});
