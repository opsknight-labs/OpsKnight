import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from '@/lib/email';
import type { EmailConfig } from '@/lib/notification-providers';

const mockSendMail = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      close: mockClose,
      on: mockOn,
    })),
  },
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
    close: mockClose,
    on: mockOn,
  })),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: vi.fn() },
    incident: { findUnique: vi.fn() },
    notificationProvider: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SMTP Provider Transport Contract', () => {
  const validConfig: EmailConfig = {
    provider: 'smtp',
    enabled: true,
    host: 'smtp.internal.corp',
    port: 587,
    user: 'notifications@internal.corp',
    password: 'smtp_secure_password',
    fromEmail: 'noreply@internal.corp',
    secure: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers email successfully via SMTP and returns messageId', async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: '<smtp-msg-abc@internal.corp>',
    });

    const result = await sendEmail(
      {
        to: 'admin@internal.corp',
        subject: 'Backup Completed',
        html: '<p>Backup successful</p>',
      },
      validConfig
    );

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('<smtp-msg-abc@internal.corp>');
    expect(result.selectedProvider).toBe('smtp');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@internal.corp',
        to: 'admin@internal.corp',
        subject: 'Backup Completed',
        html: '<p>Backup successful</p>',
      })
    );
  });

  it('fails early if SMTP host or port or credentials are missing', async () => {
    const incompleteConfig: EmailConfig = {
      provider: 'smtp',
      enabled: true,
      host: '',
      port: 0,
      user: '',
      password: '',
    };

    const result = await sendEmail(
      {
        to: 'admin@internal.corp',
        subject: 'Backup Completed',
        html: '<p>Backup successful</p>',
      },
      incompleteConfig
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP configuration incomplete');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('handles SMTP socket and network transmission errors', async () => {
    mockSendMail.mockRejectedValueOnce({
      message: 'connect ECONNREFUSED 10.0.0.5:587',
      code: 'ECONNREFUSED',
      command: 'CONN',
    });

    const result = await sendEmail(
      {
        to: 'admin@internal.corp',
        subject: 'Backup Completed',
        html: '<p>Backup successful</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ECONNREFUSED');
    expect(result.error).toContain('connect ECONNREFUSED');
  });

  it('maps 429 SMTP responseCode with retryAfterMs', async () => {
    mockSendMail.mockRejectedValueOnce({
      message: 'Too many messages sent',
      responseCode: 429,
      code: 'EML429',
    });

    const result = await sendEmail(
      {
        to: 'admin@internal.corp',
        subject: 'Backup Completed',
        html: '<p>Backup successful</p>',
      },
      validConfig
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.retryAfterMs).toBe(60_000);
  });
});
