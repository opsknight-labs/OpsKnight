/** Email providers and canonical incident-email rendering. */

import { createRequire } from 'module';
import prisma from './prisma';
import { getBaseUrl } from './env-validation';
import { getUserTimeZone, formatDateTime } from './timezone';
import { logger } from './logger';
import {
  EmailButton,
  EmailContainer,
  EmailContent,
  EmailFooter,
  EmailHeader,
  InfoCard,
  OpsKnightPromoCard,
  StatusBadge,
  escapeHtml,
} from './email-components';
import type { EmailConfig } from './notification-providers';
import { decodeNotificationEnvelope } from './notification-payload';

export type EmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
};

export type EmailDeliveryResult = {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  statusCode?: number;
  errorCode?: string;
  retryAfterMs?: number;
};

function retryAfterMs(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const deadline = Date.parse(raw);
  return Number.isFinite(deadline) ? Math.max(1_000, deadline - Date.now()) : undefined;
}

type SmtpTransporter = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
  close?: () => void;
};
type SmtpTransportCache = {
  config: Pick<EmailConfig, 'host' | 'port' | 'user' | 'password' | 'secure'>;
  transporter: SmtpTransporter;
};
let cachedSmtpTransport: SmtpTransportCache | null = null;
const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&amp;': '&',
};

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  let text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|tr|h[1-6]|li)\s*>/gi, '\n');
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  text = text.replace(
    /&(?:nbsp|lt|gt|quot|#39|apos|amp);/gi,
    match => HTML_ENTITY_MAP[match.toLowerCase()] ?? match
  );
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getSmtpTransport(emailConfig: EmailConfig): SmtpTransporter {
  const config = {
    host: emailConfig.host,
    port: emailConfig.port,
    user: emailConfig.user,
    password: emailConfig.password,
    secure: emailConfig.secure,
  };
  if (
    cachedSmtpTransport &&
    cachedSmtpTransport.config.host === config.host &&
    cachedSmtpTransport.config.port === config.port &&
    cachedSmtpTransport.config.user === config.user &&
    cachedSmtpTransport.config.password === config.password &&
    cachedSmtpTransport.config.secure === config.secure
  )
    return cachedSmtpTransport.transporter;
  cachedSmtpTransport?.transporter.close?.();
  const require = createRequire(import.meta.url);
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: parseInt(String(emailConfig.port), 10),
    secure: emailConfig.secure || false,
    auth: { user: emailConfig.user, pass: emailConfig.password },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  }) as SmtpTransporter & { on?: (event: string, handler: (err: unknown) => void) => void };
  transporter.on?.('error', (error: unknown) => {
    logger.warn('[SMTP Transport Pool Error]', {
      error: error instanceof Error ? error.message : String(error),
    });
    cachedSmtpTransport = null;
  });
  cachedSmtpTransport = { config, transporter };
  return transporter;
}

async function sendWithSingleProvider(
  options: EmailOptions,
  emailConfig: EmailConfig
): Promise<EmailDeliveryResult> {
  const textContent = options.text || htmlToPlainText(options.html);
  if (emailConfig.provider === 'resend') {
    try {
      const require = createRequire(import.meta.url);
      const { Resend } = require('resend');
      const resend = new Resend(emailConfig.apiKey || '');
      const payload = {
        from: emailConfig.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: textContent,
      };
      const result = options.idempotencyKey
        ? await resend.emails.send(payload, {
            idempotencyKey: options.idempotencyKey.slice(0, 256),
          })
        : await resend.emails.send(payload);
      if (result.error) {
        const statusCode = Number(result.error.statusCode || result.error.status) || undefined;
        return {
          success: false,
          error: result.error.message || 'Resend API error',
          statusCode,
          errorCode: result.error.name || result.error.code,
          retryAfterMs: statusCode === 429 ? 60_000 : undefined,
        };
      }
      logger.info('Email sent via Resend', { id: result.data?.id });
      return { success: true, providerMessageId: result.data?.id };
    } catch (error: unknown) {
      const value = error as { code?: string; message?: string };
      if (value.code === 'MODULE_NOT_FOUND')
        return { success: false, error: 'Resend package not installed. Run: npm install resend' };
      return { success: false, error: value.message || 'Resend send error' };
    }
  }
  if (emailConfig.provider === 'sendgrid') {
    try {
      const require = createRequire(import.meta.url);
      const sgMail = require('@sendgrid/mail');
      if (!emailConfig.apiKey?.trim())
        return { success: false, error: 'SendGrid API key is not configured' };
      if (!emailConfig.fromEmail?.trim())
        return { success: false, error: 'SendGrid from email is not configured' };
      sgMail.setApiKey(emailConfig.apiKey);
      const result = await sgMail.send({
        to: options.to,
        from: emailConfig.fromEmail,
        subject: options.subject,
        html: options.html,
        text: textContent,
        trackingSettings: {
          clickTracking: { enable: false, enableText: false },
          openTracking: { enable: false },
        },
      });
      const response = result[0];
      const responseHeaders = response?.headers as
        | Record<string, string | string[] | undefined>
        | undefined;
      const messageId = responseHeaders?.['x-message-id'];
      return response && response.statusCode >= 200 && response.statusCode < 300
        ? { success: true, providerMessageId: Array.isArray(messageId) ? messageId[0] : messageId }
        : {
            success: false,
            error: `SendGrid API returned status ${response?.statusCode}`,
            statusCode: response?.statusCode,
            retryAfterMs:
              response?.statusCode === 429
                ? (retryAfterMs(responseHeaders?.['retry-after']) ?? 60_000)
                : undefined,
          };
    } catch (error: unknown) {
      const value = error as {
        code?: string;
        message?: string;
        response?: { body?: unknown; statusCode?: number; headers?: Record<string, string> };
      };
      if (value.code === 'MODULE_NOT_FOUND')
        return { success: false, error: 'SendGrid package not installed' };
      return {
        success: false,
        error: value.response?.body
          ? JSON.stringify(value.response.body)
          : value.message || 'SendGrid API error',
        statusCode: value.response?.statusCode,
        errorCode: value.code,
        retryAfterMs:
          value.response?.statusCode === 429
            ? (retryAfterMs(value.response.headers?.['retry-after']) ?? 60_000)
            : undefined,
      };
    }
  }
  if (emailConfig.provider === 'ses') {
    try {
      const require = createRequire(import.meta.url);
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
      if (!emailConfig.apiKey || !emailConfig.host || !emailConfig.fromEmail)
        return { success: false, error: 'Amazon SES configuration incomplete' };
      const client = new SESClient({
        region: emailConfig.host,
        credentials: {
          accessKeyId: emailConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: emailConfig.apiKey,
        },
      });
      const result = await client.send(
        new SendEmailCommand({
          Destination: { ToAddresses: [options.to] },
          Message: {
            Body: {
              Html: { Charset: 'UTF-8', Data: options.html },
              Text: { Charset: 'UTF-8', Data: textContent },
            },
            Subject: { Charset: 'UTF-8', Data: options.subject },
          },
          Source: emailConfig.fromEmail,
        })
      );
      logger.info('Email sent via Amazon SES', { messageId: result.MessageId });
      return { success: true, providerMessageId: result.MessageId };
    } catch (error: unknown) {
      const value = error as {
        code?: string;
        name?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (value.code === 'MODULE_NOT_FOUND')
        return { success: false, error: 'AWS SES SDK package not installed' };
      const statusCode = value.$metadata?.httpStatusCode;
      const throttled = statusCode === 429 || /throttl/i.test(value.name || value.code || '');
      return {
        success: false,
        error: value.message || 'SES send error',
        statusCode: throttled ? 429 : statusCode,
        errorCode: value.name || value.code,
        retryAfterMs: throttled ? 60_000 : undefined,
      };
    }
  }
  if (emailConfig.provider === 'smtp') {
    try {
      if (!emailConfig.host || !emailConfig.port || !emailConfig.user || !emailConfig.password)
        return { success: false, error: 'SMTP configuration incomplete' };
      const info = await getSmtpTransport(emailConfig).sendMail({
        from: emailConfig.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: textContent,
      });
      logger.info('Email sent via SMTP', { messageId: info.messageId });
      return { success: true, providerMessageId: info.messageId };
    } catch (error: unknown) {
      const value = error as {
        code?: string;
        message?: string;
        command?: string;
        response?: string;
      };
      if (value.code === 'MODULE_NOT_FOUND')
        return { success: false, error: 'Nodemailer package not installed' };
      return {
        success: false,
        error: [value.message || 'SMTP send error', value.code, value.command, value.response]
          .filter(Boolean)
          .join(' | '),
      };
    }
  }
  return { success: false, error: 'Unknown email provider' };
}

export async function sendEmail(
  options: EmailOptions,
  providedConfig?: unknown
): Promise<EmailDeliveryResult> {
  try {
    const configsToTry: EmailConfig[] = providedConfig
      ? [providedConfig as EmailConfig]
      : await import('./notification-providers').then(module =>
          module.getAllConfiguredEmailProviders()
        );
    if (configsToTry.length === 0)
      return { success: false, error: 'No enabled email provider configured' };
    const config = configsToTry.find(item => item.enabled && item.provider);
    if (!config) return { success: false, error: 'No enabled email provider configured' };
    const result = await sendWithSingleProvider(options, config);
    if (!result.success)
      logger.warn('[Email] Provider delivery failed', {
        provider: config.provider,
        error: result.error,
      });
    return result;
  } catch (error: unknown) {
    logger.error('Email send error', { component: 'email', error });
    return { success: false, error: error instanceof Error ? error.message : 'Email send error' };
  }
}

type IncidentEmailData = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency: string;
  service: { name: string };
  assignee?: { name?: string | null; email?: string | null } | null;
  team?: { name?: string | null } | null;
  createdAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  incidentUrl?: string;
};
function eventPresentation(
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  urgency: string,
  eventMessage?: string
) {
  const escalationMatch = eventMessage?.match(/Escalation Level\s+(\d+)/i);
  if (escalationMatch) {
    return {
      header: `Escalation Level ${escalationMatch[1]}`,
      label: `Escalation Level ${escalationMatch[1]}`,
      message: `This incident has reached escalation level ${escalationMatch[1]} and requires responder attention.`,
      badge: 'error' as const,
      headerGradient: 'linear-gradient(135deg, #881337 0%, #be123c 45%, #e11d48 100%)',
      buttonBackground: 'linear-gradient(135deg, #be123c 0%, #e11d48 100%)',
      buttonShadow: '0 8px 20px rgba(225, 29, 72, 0.35)',
      accentColor: '#e11d48',
    };
  }
  if (eventType === 'resolved') {
    return {
      header: 'Incident Resolved',
      label: 'Resolved',
      message: 'This incident has been resolved.',
      badge: 'success' as const,
      headerGradient: 'linear-gradient(135deg, #064e3b 0%, #047857 45%, #059669 100%)',
      buttonBackground: 'linear-gradient(135deg, #047857 0%, #059669 100%)',
      buttonShadow: '0 8px 20px rgba(5, 150, 105, 0.35)',
      accentColor: '#059669',
    };
  }
  if (eventType === 'acknowledged') {
    return {
      header: 'Incident Acknowledged',
      label: 'Acknowledged',
      message: 'This incident has been acknowledged and is being actively worked.',
      badge: 'warning' as const,
      headerGradient: 'linear-gradient(135deg, #78350f 0%, #b45309 45%, #d97706 100%)',
      buttonBackground: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
      buttonShadow: '0 8px 20px rgba(217, 119, 6, 0.35)',
      accentColor: '#d97706',
    };
  }
  if (eventType === 'updated') {
    return {
      header: 'Incident Updated',
      label: 'Updated',
      message: 'Incident details have been updated. Review the latest committed update below.',
      badge: 'info' as const,
      headerGradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 45%, #3b82f6 100%)',
      buttonBackground: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
      buttonShadow: '0 8px 20px rgba(37, 99, 235, 0.35)',
      accentColor: '#2563eb',
    };
  }

  const isHigh = urgency === 'HIGH';
  const isMedium = urgency === 'MEDIUM';

  return {
    header: isHigh
      ? 'Critical Incident Alert'
      : isMedium
        ? 'Elevated Incident Alert'
        : 'Incident Notification',
    label: isHigh ? 'Critical Incident' : isMedium ? 'Elevated Incident' : 'New Incident',
    message: 'A new incident has been reported. Review the details and take action.',
    badge: isHigh ? ('error' as const) : isMedium ? ('warning' as const) : ('info' as const),
    headerGradient: isHigh
      ? 'linear-gradient(135deg, #881337 0%, #be123c 45%, #e11d48 100%)'
      : isMedium
        ? 'linear-gradient(135deg, #78350f 0%, #b45309 45%, #d97706 100%)'
        : 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 45%, #3b82f6 100%)',
    buttonBackground: isHigh
      ? 'linear-gradient(135deg, #be123c 0%, #e11d48 100%)'
      : isMedium
        ? 'linear-gradient(135deg, #b45309 0%, #d97706 100%)'
        : 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
    buttonShadow: isHigh
      ? '0 8px 20px rgba(225, 29, 72, 0.35)'
      : isMedium
        ? '0 8px 20px rgba(217, 119, 6, 0.35)'
        : '0 8px 20px rgba(37, 99, 235, 0.35)',
    accentColor: isHigh ? '#e11d48' : isMedium ? '#d97706' : '#2563eb',
  };
}

export function generateIncidentEmailHTML(
  incident: IncidentEmailData,
  timeZone: string = 'UTC',
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated' = 'triggered',
  eventMessage?: string
): string {
  const presentation = eventPresentation(eventType, incident.urgency, eventMessage);
  const incidentUrl = incident.incidentUrl || `${getBaseUrl()}/incidents/${incident.id}`;
  const assigneeName =
    incident.assignee?.name ||
    incident.assignee?.email ||
    (incident.team?.name ? `${incident.team.name} (Team)` : '') ||
    'Unassigned';
  const infoItems = [
    { label: 'Service', value: incident.service?.name || 'Service', highlight: true },
    { label: 'Status', value: incident.status },
    { label: 'Urgency', value: incident.urgency },
    { label: 'Assignee', value: assigneeName },
    {
      label: 'Created',
      value: formatDateTime(incident.createdAt, timeZone, { format: 'datetime' }),
    },
  ];
  if (incident.acknowledgedAt)
    infoItems.push({
      label: 'Acknowledged',
      value: formatDateTime(incident.acknowledgedAt, timeZone, { format: 'datetime' }),
    });
  if (incident.resolvedAt)
    infoItems.push({
      label: 'Resolved',
      value: formatDateTime(incident.resolvedAt, timeZone, { format: 'datetime' }),
    });
  // Deduplicate context/eventMessage if it merely echoes incident title or [Service] title
  const serviceName = incident.service?.name || '';
  const trimmedMsg = (eventMessage || '').trim().toLowerCase();
  const trimmedTitle = incident.title.trim().toLowerCase();
  const prefixedTitle = `[${serviceName}] ${incident.title}`.trim().toLowerCase();
  const isDuplicateMessage =
    trimmedMsg === trimmedTitle ||
    trimmedMsg === prefixedTitle ||
    (trimmedMsg.startsWith(`[${serviceName.toLowerCase()}]`) &&
      trimmedMsg.endsWith(trimmedTitle));

  const context =
    eventMessage && !isDuplicateMessage
      ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid ${presentation.accentColor};border-radius:8px;padding:12px 16px;margin:16px 0;color:#334155;font-size:13px;line-height:1.5;">${escapeHtml(eventMessage)}</div>`
      : '';

  // Structured Incident Description (replaces raw uncontained "Overview" header)
  const description = incident.description
    ? `<div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${presentation.accentColor};border-radius:8px;padding:14px 18px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin-bottom:6px;">
          Incident Description
        </div>
        <div style="white-space:pre-wrap;font-size:14px;color:#334155;line-height:1.6;word-break:break-word;">
          ${escapeHtml(incident.description)}
        </div>
      </div>`
    : '';

  return EmailContainer(
    EmailHeader(
      presentation.header,
      `Service: ${escapeHtml(incident.service?.name || 'Service')}`,
      {
        headerGradient: presentation.headerGradient,
        logoUrl: `${getBaseUrl()}/logo-compressed.png`,
      }
    ) +
      EmailContent(`
        <div style="margin-bottom:16px">${StatusBadge(presentation.label.toUpperCase(), presentation.badge)}</div>
        <div style="font-size:14px;color:#475569;margin-bottom:18px;line-height:1.5;">${escapeHtml(presentation.message)}</div>
        <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px 0;line-height:1.35;letter-spacing:-0.01em;">${escapeHtml(incident.title)}</h2>
        ${context}
        ${InfoCard(infoItems, { accentColor: presentation.accentColor })}
        ${description}
        <div style="margin-top:24px;text-align:center;">${EmailButton(
          eventType === 'resolved' ? 'View Resolution' : 'View Incident',
          escapeHtml(incidentUrl),
          {
            buttonBackground: presentation.buttonBackground,
            buttonShadow: presentation.buttonShadow,
          }
        )}</div>
      `) +
      EmailFooter()
  );
}

export async function sendIncidentEmail(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated',
  notificationId?: string,
  durableMessage?: string,
  providedConfig?: EmailConfig
): Promise<EmailDeliveryResult> {
  try {
    const [user, currentIncident] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: { service: true, assignee: true, team: true },
      }),
    ]);
    if (!user || !currentIncident) return { success: false, error: 'User or incident not found' };
    const envelope = decodeNotificationEnvelope(durableMessage);
    const snapshot = envelope?.snapshot;
    const eventIncident = snapshot
      ? {
          id: snapshot.incidentId,
          title: snapshot.title,
          description: snapshot.description,
          status: snapshot.status,
          urgency: snapshot.urgency,
          service: { name: snapshot.service.name },
          assignee: snapshot.assignee,
          team: snapshot.team,
          createdAt: new Date(snapshot.createdAt),
          acknowledgedAt: snapshot.acknowledgedAt ? new Date(snapshot.acknowledgedAt) : null,
          resolvedAt: snapshot.resolvedAt ? new Date(snapshot.resolvedAt) : null,
        }
      : {
          ...currentIncident,
          status:
            eventType === 'resolved'
              ? 'RESOLVED'
              : eventType === 'acknowledged'
                ? 'ACKNOWLEDGED'
                : eventType === 'triggered'
                  ? 'OPEN'
                  : currentIncident.status,
          resolvedAt: eventType === 'resolved' ? currentIncident.resolvedAt : null,
        };
    const escalationLevel = snapshot?.escalationLevel ?? null;
    const subjectTag = escalationLevel
      ? `ESCALATION L${escalationLevel}`
      : eventType === 'resolved'
        ? 'RESOLVED'
        : eventType === 'acknowledged'
          ? 'ACKNOWLEDGED'
          : eventType === 'updated'
            ? 'UPDATED'
            : eventIncident.urgency === 'HIGH'
              ? 'CRITICAL'
              : eventIncident.urgency === 'MEDIUM'
                ? 'ELEVATED'
                : 'NEW';
    const incidentUrl = `${getBaseUrl()}/incidents/${incidentId}`;
    const userTimeZone = getUserTimeZone(user ?? undefined);
    const html = generateIncidentEmailHTML(
      { ...eventIncident, incidentUrl },
      userTimeZone,
      eventType,
      envelope?.displayMessage
    );
    const displayMessage = envelope?.displayMessage;
    return sendEmail(
      {
        to: user.email,
        subject: `[${subjectTag}] ${eventIncident.title}`,
        html,
        text: `${eventIncident.title}\n\nService: ${eventIncident.service.name}\nStatus: ${eventIncident.status}\nUrgency: ${eventIncident.urgency}${displayMessage ? `\n\n${displayMessage}` : ''}\n\nView: ${incidentUrl}`,
        idempotencyKey: notificationId,
      },
      providedConfig
    );
  } catch (error: unknown) {
    logger.error('Send incident email error', {
      component: 'email',
      error,
      incidentId,
      userId,
      eventType,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Send incident email error',
    };
  }
}

export type ShiftReminderData = {
  userName: string;
  scheduleName: string;
  scheduleUrl: string;
  shiftStart: Date;
  shiftEnd: Date;
  timeZone: string;
  minutesUntilStart: number;
};

export function generateShiftReminderEmailHTML(data: ShiftReminderData): string {
  const headerGradient = 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 45%, #7c3aed 100%)';
  const buttonBackground = 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)';
  const buttonShadow = '0 8px 20px rgba(124, 58, 237, 0.35)';

  const formattedStart = formatDateTime(data.shiftStart, data.timeZone, { format: 'datetime' });
  const formattedEnd = formatDateTime(data.shiftEnd, data.timeZone, { format: 'datetime' });
  const durationHours = Math.max(
    1,
    Math.round((data.shiftEnd.getTime() - data.shiftStart.getTime()) / (1000 * 60 * 60))
  );

  const infoItems = [
    { label: 'Schedule', value: data.scheduleName, highlight: true },
    { label: 'Starts In', value: `~${data.minutesUntilStart} minute(s)` },
    { label: 'Shift Start', value: `${formattedStart} (${data.timeZone})` },
    { label: 'Shift End', value: `${formattedEnd} (${data.timeZone})` },
    { label: 'Duration', value: `${durationHours} hour(s)` },
  ];

  return EmailContainer(
    EmailHeader('Upcoming On-Call Shift', `Schedule: ${escapeHtml(data.scheduleName)}`, {
      headerGradient,
      logoUrl: `${getBaseUrl()}/logo-compressed.png`,
    }) +
      EmailContent(`
        <div style="margin-bottom:18px">${StatusBadge('UPCOMING ON-CALL', 'schedule')}</div>
        <h2 style="font-size:22px;color:#0f172a;margin-bottom:12px">Hi ${escapeHtml(data.userName)}, your on-call shift is starting soon!</h2>
        <p style="font-size:14px;color:#475569;margin-bottom:20px;line-height:1.6">
          You are scheduled to go on-call for <strong>${escapeHtml(data.scheduleName)}</strong> in approximately <strong>${data.minutesUntilStart} minute(s)</strong>.
          Please ensure your notification channels are active and you are prepared to respond to alerts.
        </p>
        ${InfoCard(infoItems, { accentColor: '#7c3aed' })}
        <div style="margin-top:24px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 20px;color:#5b21b6;font-size:13px;line-height:1.6">
          <strong>💡 Responder Checklist:</strong>
          <ul style="margin:8px 0 0 0;padding-left:20px">
            <li>Verify your phone/SMS and mobile push notifications are unmuted.</li>
            <li>Review active incidents or maintenance windows before taking over.</li>
            <li>Coordinate with outgoing responders if any handoff context is pending.</li>
          </ul>
        </div>
        <div style="margin-top:28px;text-align:center;">${EmailButton('View On-Call Schedule', escapeHtml(data.scheduleUrl), { buttonBackground, buttonShadow })}</div>
      `) +
      EmailFooter()
  );
}

export async function sendShiftReminderEmail(
  data: ShiftReminderData & { to: string }
): Promise<EmailDeliveryResult> {
  const subject = `⏰ [Upcoming Shift] You are on-call for "${data.scheduleName}" in ~${data.minutesUntilStart}m`;
  const html = generateShiftReminderEmailHTML(data);
  const text = `Upcoming On-Call Shift: You are scheduled to go on-call for "${data.scheduleName}" in approximately ${data.minutesUntilStart} minutes.\n\nSchedule: ${data.scheduleUrl}`;
  return sendEmail({
    to: data.to,
    subject,
    html,
    text,
  });
}

export type ShiftHandoffData = {
  userName: string;
  scheduleName: string;
  scheduleUrl: string;
  activeIncidents: Array<{
    id: string;
    title: string;
    status: string;
    incidentUrl: string;
  }>;
  timeZone: string;
};

export function generateShiftHandoffEmailHTML(data: ShiftHandoffData): string {
  const headerGradient = 'linear-gradient(135deg, #1e3a8a 0%, #312e81 45%, #4338ca 100%)';
  const buttonBackground = 'linear-gradient(135deg, #3730a3 0%, #4338ca 100%)';
  const buttonShadow = '0 8px 20px rgba(67, 56, 202, 0.35)';

  const incidentListHtml = data.activeIncidents
    .map(
      inc => `
      <div style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px">
        <div style="font-weight:600;font-size:14px;color:#0f172a">${escapeHtml(inc.title)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">
          Status: <strong>${escapeHtml(inc.status)}</strong> · <a href="${escapeHtml(inc.incidentUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600">Open Incident &rarr;</a>
        </div>
      </div>`
    )
    .join('');

  return EmailContainer(
    EmailHeader('Shift Rotation Handoff', `Schedule: ${escapeHtml(data.scheduleName)}`, {
      headerGradient,
      logoUrl: `${getBaseUrl()}/logo-compressed.png`,
    }) +
      EmailContent(`
        <div style="margin-bottom:18px">${StatusBadge('SHIFT HANDOFF', 'schedule')}</div>
        <h2 style="font-size:22px;color:#0f172a;margin-bottom:12px">Hi ${escapeHtml(data.userName)}, you are now On-Call</h2>
        <p style="font-size:14px;color:#475569;margin-bottom:20px;line-height:1.6">
          Your on-call shift for <strong>${escapeHtml(data.scheduleName)}</strong> has started.
          The following <strong>${data.activeIncidents.length} active incident(s)</strong> have been automatically reassigned to you:
        </p>
        ${incidentListHtml}
        <div style="margin-top:28px;text-align:center;">${EmailButton('View Schedule & Incidents', escapeHtml(data.scheduleUrl), { buttonBackground, buttonShadow })}</div>
      `) +
      EmailFooter()
  );
}

export async function sendShiftHandoffEmail(
  data: ShiftHandoffData & { to: string }
): Promise<EmailDeliveryResult> {
  const subject = `🔄 [Shift Handoff] You are now On-Call for "${data.scheduleName}" (${data.activeIncidents.length} active incidents)`;
  const html = generateShiftHandoffEmailHTML(data);
  const text = `Shift Handoff: You are now on-call for "${data.scheduleName}" with ${data.activeIncidents.length} active incident(s).\n\nSchedule: ${data.scheduleUrl}`;
  return sendEmail({
    to: data.to,
    subject,
    html,
    text,
  });
}
