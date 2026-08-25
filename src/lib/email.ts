/**
 * Email Notification Service
 * Sends email notifications for incidents
 *
 * Email providers are configured via the UI at Settings → System → Notification Providers
 *
 * To use with Resend (recommended):
 * 1. Install: npm install resend
 * 2. Configure Resend in Settings → System → Notification Providers
 *
 * To use with SendGrid:
 * 1. Install: npm install @sendgrid/mail
 * 2. Configure SendGrid in Settings → System → Notification Providers
 */

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
  StatusBadge,
  escapeHtml,
} from './email-components';
import type { EmailConfig } from './notification-providers';

export type EmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

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

  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== prev);

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
  ) {
    return cachedSmtpTransport.transporter;
  }

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

  // Attach error handler to prevent process crashes on idle background socket resets
  if (typeof transporter.on === 'function') {
    transporter.on('error', (err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn('[SMTP Transport Pool Error]', { error: errorMsg });
      cachedSmtpTransport = null;
    });
  }

  cachedSmtpTransport = { config, transporter };
  return transporter;
}

async function sendWithSingleProvider(
  options: EmailOptions,
  emailConfig: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  const textContent = options.text || htmlToPlainText(options.html);

  if (emailConfig.provider === 'resend') {
    try {
      const require = createRequire(import.meta.url);
      const { Resend } = require('resend');
      const resend = new Resend(emailConfig.apiKey || '');

      const result = await resend.emails.send({
        from: emailConfig.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: textContent,
      });

      if (result.error) {
        logger.error('Resend email send failed', {
          component: 'email',
          provider: 'resend',
          error: result.error,
          to: options.to,
        });
        return { success: false, error: result.error.message || 'Resend API error' };
      }

      logger.info('Email sent via Resend', { to: options.to, id: result.data?.id });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'MODULE_NOT_FOUND') {
        logger.warn('Resend package not installed', { installCommand: 'npm install resend' });
        return { success: false, error: 'Resend package not installed. Run: npm install resend' };
      }
      logger.error('Resend send error', { component: 'email', provider: 'resend', error, to: options.to });
      return { success: false, error: err.message || 'Resend send error' };
    }
  }

  if (emailConfig.provider === 'sendgrid') {
    try {
      const require = createRequire(import.meta.url);
      const sgMail = require('@sendgrid/mail');

      if (!emailConfig.apiKey || emailConfig.apiKey.trim() === '') {
        return { success: false, error: 'SendGrid API key is not configured' };
      }
      if (!emailConfig.fromEmail || emailConfig.fromEmail.trim() === '') {
        return { success: false, error: 'SendGrid from email is not configured' };
      }

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
      if (response && response.statusCode >= 200 && response.statusCode < 300) {
        logger.info('Email sent via SendGrid', {
          to: options.to,
          from: emailConfig.fromEmail,
          subject: options.subject,
          statusCode: response.statusCode,
        });
        return { success: true };
      }
      return {
        success: false,
        error: `SendGrid API returned status ${response?.statusCode}: ${JSON.stringify(response?.body)}`,
      };
    } catch (error: unknown) {
      const err = error as {
        code?: string;
        message?: string;
        response?: { body?: { errors?: unknown } };
      };
      if (err.code === 'MODULE_NOT_FOUND') {
        return { success: false, error: 'SendGrid package not installed' };
      }
      const errorMessage =
        typeof err.response?.body === 'object' && err.response?.body && 'errors' in err.response.body
          ? JSON.stringify(err.response.body.errors)
          : err.message || 'SendGrid API error';
      return { success: false, error: errorMessage };
    }
  }

  if (emailConfig.provider === 'ses') {
    try {
      const require = createRequire(import.meta.url);
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

      if (!emailConfig.apiKey || !emailConfig.host || !emailConfig.fromEmail) {
        return { success: false, error: 'Amazon SES configuration incomplete' };
      }

      const sesClient = new SESClient({
        region: emailConfig.host,
        credentials: {
          accessKeyId: emailConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: emailConfig.apiKey || '',
        },
      });

      const command = new SendEmailCommand({
        Destination: { ToAddresses: [options.to] },
        Message: {
          Body: {
            Html: { Charset: 'UTF-8', Data: options.html },
            Text: { Charset: 'UTF-8', Data: textContent },
          },
          Subject: { Charset: 'UTF-8', Data: options.subject },
        },
        Source: emailConfig.fromEmail,
      });

      const result = await sesClient.send(command);
      logger.info('Email sent via Amazon SES', { to: options.to, messageId: result.MessageId });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'MODULE_NOT_FOUND') {
        return { success: false, error: 'AWS SES SDK package not installed' };
      }
      return { success: false, error: err.message || 'SES send error' };
    }
  }

  if (emailConfig.provider === 'smtp') {
    try {
      if (!emailConfig.host || !emailConfig.port || !emailConfig.user || !emailConfig.password) {
        return { success: false, error: 'SMTP configuration incomplete' };
      }

      const transporter = getSmtpTransport(emailConfig);
      const info = await transporter.sendMail({
        from: emailConfig.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: textContent,
      });

      logger.info('Email sent via SMTP', { to: options.to, messageId: info.messageId });
      return { success: true };
    } catch (error: unknown) {
      const err = error as {
        code?: string;
        message?: string;
        command?: string;
        response?: string;
      };
      if (err.code === 'MODULE_NOT_FOUND') {
        return { success: false, error: 'Nodemailer package not installed' };
      }
      const errorParts = [
        err.message || 'SMTP send error',
        err.code ? `code=${err.code}` : null,
        err.command ? `command=${err.command}` : null,
        err.response ? `response=${err.response}` : null,
      ].filter(Boolean);
      return { success: false, error: errorParts.join(' | ') };
    }
  }

  return { success: false, error: 'Unknown email provider' };
}

/**
 * Send email notification with automatic provider failover
 * @param options Email options
 * @param providedConfig Optional email config - if provided, uses this instead of fetching from DB
 */
export async function sendEmail(
  options: EmailOptions,
  providedConfig?: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    let configsToTry: EmailConfig[] = [];
    if (providedConfig) {
      configsToTry = [providedConfig as EmailConfig];
    } else {
      const { getAllConfiguredEmailProviders } = await import('./notification-providers');
      configsToTry = await getAllConfiguredEmailProviders();
    }

    if (configsToTry.length === 0) {
      logger.warn('Email notification skipped - no enabled email provider configured', {
        to: options.to,
        subject: options.subject,
      });
      return { success: false, error: 'No enabled email provider configured' };
    }

    let lastError = 'Failed to send email';
    for (const config of configsToTry) {
      if (!config.enabled || !config.provider) continue;
      const result = await sendWithSingleProvider(options, config);
      if (result.success) {
        return { success: true };
      }
      lastError = result.error || 'Provider send failed';
      logger.warn(`[Email] Provider ${config.provider} failed, trying fallback provider if available`, {
        provider: config.provider,
        error: result.error,
        to: options.to,
      });
    }

    return { success: false, error: lastError };
  } catch (error: unknown) {
    logger.error('Email send error', { component: 'email', error, to: options.to });
    const err = error as { message?: string };
    return { success: false, error: err.message || 'Email send error' };
  }
}

/**
 * Generate email HTML for incident notification
 */
export function generateIncidentEmailHTML(
  incident: {
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
  },
  timeZone: string = 'UTC',
  eventType?: 'triggered' | 'acknowledged' | 'resolved'
): string {
  const baseUrl = getBaseUrl();
  const incidentUrl = incident.incidentUrl || `${baseUrl}/incidents/${incident.id}`;
  const safeIncidentUrl = escapeHtml(incidentUrl);
  const safeServiceName = escapeHtml(incident.service?.name || 'Service');
  const safeIncidentTitle = escapeHtml(incident.title || 'Incident');
  const safeDescription = incident.description ? escapeHtml(incident.description) : '';
  const safeStatus = escapeHtml(incident.status);
  const safeUrgency = escapeHtml(incident.urgency);
  const assigneeName =
    incident.assignee?.name ||
    incident.assignee?.email ||
    (incident.team?.name ? `${incident.team.name} (Team)` : '') ||
    'Unassigned';
  const safeAssigneeName = escapeHtml(assigneeName);

  const normalizedEventType =
    eventType ||
    (incident.status === 'RESOLVED'
      ? 'resolved'
      : incident.status === 'ACKNOWLEDGED'
        ? 'acknowledged'
        : 'triggered');

  const headerTitle =
    normalizedEventType === 'resolved'
      ? 'Incident Resolved'
      : normalizedEventType === 'acknowledged'
        ? 'Incident Acknowledged'
        : incident.urgency === 'HIGH'
          ? 'Critical Incident Alert'
          : incident.urgency === 'MEDIUM'
            ? 'Elevated Incident Alert'
            : 'Incident Notification';
  const headerSubtitle = `Service: ${safeServiceName}`;

  const updateTitle =
    normalizedEventType === 'resolved'
      ? 'Resolved'
      : normalizedEventType === 'acknowledged'
        ? 'Acknowledged'
        : incident.urgency === 'HIGH'
          ? 'Critical Incident'
          : incident.urgency === 'MEDIUM'
            ? 'Elevated Incident'
            : 'New Incident';
  const updateMessage =
    normalizedEventType === 'resolved'
      ? 'This incident has been resolved. Review the summary and timeline below.'
      : normalizedEventType === 'acknowledged'
        ? 'This incident has been acknowledged and is being actively worked.'
        : 'A new incident has been reported. Review the details and take action.';

  const theme =
    normalizedEventType === 'resolved'
      ? {
          badgeType: 'success' as const,
          accent: '#059669',
          background: '#f0fdf4',
          border: '#d1fae5',
          title: '#064e3b',
          text: '#065f46',
          headerGradient: 'linear-gradient(135deg, #064e3b 0%, #16a34a 50%, #22c55e 100%)',
          buttonBackground: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
          buttonShadow: '0 10px 22px rgba(16, 185, 129, 0.35)',
        }
      : normalizedEventType === 'acknowledged'
        ? {
            badgeType: 'warning' as const,
            accent: '#d97706',
            background: '#fffbeb',
            border: '#fde68a',
            title: '#78350f',
            text: '#92400e',
            headerGradient: 'linear-gradient(135deg, #78350f 0%, #d97706 50%, #f59e0b 100%)',
            buttonBackground: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
            buttonShadow: '0 10px 22px rgba(217, 119, 6, 0.35)',
          }
        : incident.urgency === 'HIGH'
          ? {
              badgeType: 'error' as const,
              accent: '#be123c',
              background: '#fef2f2',
              border: '#fecaca',
              title: '#881337',
              text: '#991b1b',
              headerGradient: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%)',
              buttonBackground: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
              buttonShadow: '0 10px 22px rgba(185, 28, 28, 0.35)',
            }
          : incident.urgency === 'MEDIUM'
            ? {
                badgeType: 'warning' as const,
                accent: '#d97706',
                background: '#fffbeb',
                border: '#fde68a',
                title: '#78350f',
                text: '#92400e',
                headerGradient: 'linear-gradient(135deg, #78350f 0%, #d97706 50%, #f59e0b 100%)',
                buttonBackground: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
                buttonShadow: '0 10px 22px rgba(217, 119, 6, 0.35)',
              }
            : {
                badgeType: 'info' as const,
                accent: '#2563eb',
                background: '#eff6ff',
                border: '#bfdbfe',
                title: '#1e3a8a',
                text: '#1d4ed8',
                headerGradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)',
                buttonBackground: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                buttonShadow: '0 10px 22px rgba(37, 99, 235, 0.35)',
              };

  const formatDuration = (start: Date, end?: Date | null) => {
    if (!end) return 'N/A';
    const diffMs = end.getTime() - start.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'N/A';
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(' ');
  };

  const infoItems = [
    { label: 'Service', value: safeServiceName, highlight: true },
    { label: 'Status', value: safeStatus },
    { label: 'Urgency', value: safeUrgency },
    { label: 'Assignee', value: safeAssigneeName },
    {
      label: 'Created',
      value: formatDateTime(incident.createdAt, timeZone, { format: 'datetime' }),
    },
  ];

  if (incident.acknowledgedAt) {
    infoItems.push({
      label: 'Acknowledged',
      value: formatDateTime(incident.acknowledgedAt, timeZone, { format: 'datetime' }),
    });
  }

  if (incident.resolvedAt) {
    infoItems.push({
      label: 'Resolved',
      value: formatDateTime(incident.resolvedAt, timeZone, { format: 'datetime' }),
    });
    infoItems.push({
      label: 'Time to Resolve',
      value: formatDuration(incident.createdAt, incident.resolvedAt),
    });
  }

  const urgencyColors: Record<string, { bg: string; text: string; border: string }> = {
    HIGH: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
    MEDIUM: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
    LOW: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  };
  const urgencyKey = incident.urgency?.toUpperCase() || 'LOW';
  const urgencyTheme = urgencyColors[urgencyKey] || urgencyColors.LOW;

  const content = `
        ${EmailHeader(headerTitle, headerSubtitle, { headerGradient: theme.headerGradient })}
        
        ${EmailContent(`
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 22px;">
                ${StatusBadge(updateTitle.toUpperCase(), theme.badgeType)}
                <span style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: ${urgencyTheme.bg}; border: 1px solid ${urgencyTheme.border}; color: ${urgencyTheme.text}; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">
                    ${safeUrgency}
                </span>
            </div>

            <div style="background: ${theme.background}; border: 1px solid ${theme.border}; border-left: 4px solid ${theme.accent}; padding: 16px 18px; border-radius: 12px; margin-bottom: 26px;">
                <p style="margin: 0; color: ${theme.title}; font-size: 14px; font-weight: 700;">
                    ${updateTitle}
                </p>
                <p style="margin: 6px 0 0; color: ${theme.text}; font-size: 13px; line-height: 1.6;">
                    ${updateMessage}
                </p>
            </div>

            <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 22px; font-weight: 700; line-height: 1.35;">
                ${safeIncidentTitle}
            </h2>

            <h3 style="margin: 26px 0 12px 0; color: #111827; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">
                Incident Summary
            </h3>
            ${InfoCard(infoItems, { accentColor: theme.accent })}

            ${
              safeDescription
                ? `
            <h3 style="margin: 26px 0 12px 0; color: #111827; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">
                Overview
            </h3>
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">
                    ${safeDescription}
                </p>
            </div>
            `
                : ''
            }

            ${
              normalizedEventType === 'resolved'
                ? `
            <h3 style="margin: 26px 0 12px 0; color: #111827; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">
                Resolution
            </h3>
            <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7;">
                    Incident marked resolved${incident.resolvedAt ? ` on ${formatDateTime(incident.resolvedAt, timeZone, { format: 'datetime' })}.` : '.'}
                </p>
            </div>
            `
                : ''
            }

            ${EmailButton(
              normalizedEventType === 'resolved' ? 'View Resolution' : 'View Incident',
              safeIncidentUrl,
              {
                buttonBackground: theme.buttonBackground,
                buttonShadow: theme.buttonShadow,
              }
            )}
        `)}
        
        ${EmailFooter()}
    `;

  return EmailContainer(content);
}

/**
 * Send incident notification email
 */
export async function sendIncidentEmail(
  userId: string,
  incidentId: string,
  eventType: 'triggered' | 'acknowledged' | 'resolved'
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user, incident] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          service: true,
          assignee: true,
          team: true,
        },
      }),
    ]);

    if (!user || !incident) {
      return { success: false, error: 'User or incident not found' };
    }

    const baseUrl = getBaseUrl();
    const incidentUrl = `${baseUrl}/incidents/${incidentId}`;

    const subjectTag =
      eventType === 'resolved'
        ? 'RESOLVED'
        : eventType === 'acknowledged'
          ? 'ACKNOWLEDGED'
          : incident.urgency === 'HIGH'
            ? 'CRITICAL'
            : incident.urgency === 'MEDIUM'
              ? 'ELEVATED'
              : 'NEW';
    const subject = `[${subjectTag}] ${incident.title}`;
    const userTimeZone = getUserTimeZone(user ?? undefined);
    const html = generateIncidentEmailHTML(
      {
        ...incident,
        incidentUrl,
      },
      userTimeZone,
      eventType
    );

    return await sendEmail({
      to: user.email,
      subject,
      html,
      text: `${incident.title}\n\nService: ${incident.service.name}\nStatus: ${incident.status}\nUrgency: ${incident.urgency}\n\n${subjectTag} update. View: ${incidentUrl}`,
    });
  } catch (error: unknown) {
    logger.error('Send incident email error', {
      component: 'email',
      error,
      incidentId,
      userId,
      eventType,
    });
    const err = error as { message?: string };
    return { success: false, error: err.message || 'Send incident email error' };
  }
}
