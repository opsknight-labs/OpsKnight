import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from '@/lib/email';
import { listUnsubscribeHeaders } from '@/lib/notification-control-plane';
import type { EmailConfig } from '@/lib/notification-providers';

const mocks = vi.hoisted(() => ({
  sesSend: vi.fn(),
  smtpSendMail: vi.fn(),
  resendSend: vi.fn(),
  sendgridSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-ses', () => {
  class SESClient {
    send = mocks.sesSend;
  }
  class SendEmailCommand {
    constructor(public input: unknown) {}
  }
  class SendRawEmailCommand {
    constructor(public input: { RawMessage: { Data: Uint8Array } }) {}
  }
  return { SESClient, SendEmailCommand, SendRawEmailCommand };
});

// SMTP gets a fake pooled transport; the SES raw path keeps nodemailer's real MIME composer.
vi.mock('nodemailer', async () => {
  const actual = await vi.importActual<typeof import('nodemailer')>('nodemailer');
  const createTransport = (options: Record<string, unknown>) =>
    options.streamTransport
      ? actual.createTransport(options as never)
      : { sendMail: mocks.smtpSendMail, close: vi.fn(), on: vi.fn() };
  return { default: { createTransport }, createTransport };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.resendSend };
  },
}));

vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: mocks.sendgridSend },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const headers = listUnsubscribeHeaders('https://app.example.com/api/status/subscriptions/unsubscribe/one-click/tok')!;
const message = { to: 'sub@example.com', subject: 'Update', html: '<p>Hello</p>', text: 'Hello', headers };

describe('List-Unsubscribe headers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds RFC 8058 one-click headers for https URLs only', () => {
    expect(headers).toEqual({
      'List-Unsubscribe': '<https://app.example.com/api/status/subscriptions/unsubscribe/one-click/tok>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(listUnsubscribeHeaders(undefined)).toBeUndefined();
    expect(listUnsubscribeHeaders('http://insecure.example.com/x')).toBeUndefined();
  });

  it('sends a raw MIME message through SES so the headers survive', async () => {
    mocks.sesSend.mockResolvedValueOnce({ MessageId: 'ses-raw-1' });
    const config: EmailConfig = {
      provider: 'ses',
      enabled: true,
      apiKey: 'secret',
      accessKeyId: 'id',
      host: 'us-east-1',
      fromEmail: 'alerts@example.com',
    };
    const result = await sendEmail(message, config);
    expect(result).toMatchObject({ success: true, providerMessageId: 'ses-raw-1' });
    const command = mocks.sesSend.mock.calls[0][0] as { input: { RawMessage: { Data: Uint8Array } } };
    // Unfold RFC 5322 folded header lines before matching.
    const raw = Buffer.from(command.input.RawMessage.Data).toString('utf8').replace(/\r\n[ \t]+/g, ' ');
    expect(raw).toContain('List-Unsubscribe: <https://app.example.com/api/status/subscriptions/unsubscribe/one-click/tok>');
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
    expect(raw).toContain('To: sub@example.com');
  });

  it('passes the headers to SMTP, Resend and SendGrid', async () => {
    mocks.smtpSendMail.mockResolvedValueOnce({ messageId: 'smtp-1' });
    await sendEmail(message, {
      provider: 'smtp',
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      user: 'u',
      password: 'p',
      fromEmail: 'alerts@example.com',
    } as EmailConfig);
    expect(mocks.smtpSendMail.mock.calls[0][0]).toMatchObject({ headers });

    mocks.resendSend.mockResolvedValueOnce({ data: { id: 'resend-1' } });
    await sendEmail(message, {
      provider: 'resend',
      enabled: true,
      apiKey: 're_test',
      fromEmail: 'alerts@example.com',
    } as EmailConfig);
    expect(mocks.resendSend.mock.calls[0][0]).toMatchObject({ headers });

    mocks.sendgridSend.mockResolvedValueOnce([{ statusCode: 202, headers: {} }]);
    await sendEmail(message, {
      provider: 'sendgrid',
      enabled: true,
      apiKey: 'SG.test',
      fromEmail: 'alerts@example.com',
    } as EmailConfig);
    expect(mocks.sendgridSend.mock.calls[0][0]).toMatchObject({ headers });
  });

  it('derives a readable plain-text part when only HTML is provided', async () => {
    mocks.smtpSendMail.mockResolvedValueOnce({ messageId: 'smtp-2' });
    await sendEmail(
      { to: 'a@example.com', subject: 's', html: '<h1>Status</h1><p>All <strong>good</strong></p>' },
      {
        provider: 'smtp',
        enabled: true,
        host: 'smtp.example.com',
        port: 587,
        user: 'u',
        password: 'p',
        fromEmail: 'alerts@example.com',
      } as EmailConfig
    );
    expect(mocks.smtpSendMail.mock.calls[0][0].text).toBe('Status\n\nAll good');
  });
});
