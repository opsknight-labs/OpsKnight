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

type SmtpTransporter = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
  close?: () => void;
};
type SmtpTransportCache = {
  config: Pick<EmailConfig, 'host' | 'port' | 'user' | 'password' | 'secure'>;
  transporter: SmtpTransporter;
};
let cachedSmtpTransport: SmtpTransportCache | null = null;
const HTML_ENTITY_MAP: Record<string, string> = { '&nbsp;':' ', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':"'", '&apos;':"'", '&amp;':'&' };

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  let text = html.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\s*\/\s*(?:p|div|tr|h[1-6]|li)\s*>/gi, '\n');
  let previous: string;
  do { previous = text; text = text.replace(/<[^>]*>/g, ''); } while (text !== previous);
  text = text.replace(/&(?:nbsp|lt|gt|quot|#39|apos|amp);/gi, match => HTML_ENTITY_MAP[match.toLowerCase()] ?? match);
  return text.replace(/\r\n|\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getSmtpTransport(emailConfig: EmailConfig): SmtpTransporter {
  const config = { host: emailConfig.host, port: emailConfig.port, user: emailConfig.user, password: emailConfig.password, secure: emailConfig.secure };
  if (cachedSmtpTransport && cachedSmtpTransport.config.host === config.host && cachedSmtpTransport.config.port === config.port && cachedSmtpTransport.config.user === config.user && cachedSmtpTransport.config.password === config.password && cachedSmtpTransport.config.secure === config.secure) return cachedSmtpTransport.transporter;
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
    logger.warn('[SMTP Transport Pool Error]', { error: error instanceof Error ? error.message : String(error) });
    cachedSmtpTransport = null;
  });
  cachedSmtpTransport = { config, transporter };
  return transporter;
}

async function sendWithSingleProvider(options: EmailOptions, emailConfig: EmailConfig): Promise<{ success: boolean; error?: string }> {
  const textContent = options.text || htmlToPlainText(options.html);
  if (emailConfig.provider === 'resend') {
    try {
      const require = createRequire(import.meta.url);
      const { Resend } = require('resend');
      const resend = new Resend(emailConfig.apiKey || '');
      const payload = { from: emailConfig.fromEmail, to: options.to, subject: options.subject, html: options.html, text: textContent };
      const result = options.idempotencyKey ? await resend.emails.send(payload, { idempotencyKey: options.idempotencyKey.slice(0,256) }) : await resend.emails.send(payload);
      if (result.error) return { success:false, error: result.error.message || 'Resend API error' };
      logger.info('Email sent via Resend', { id: result.data?.id });
      return { success:true };
    } catch (error: unknown) {
      const value = error as { code?: string; message?: string };
      if (value.code === 'MODULE_NOT_FOUND') return { success:false, error:'Resend package not installed. Run: npm install resend' };
      return { success:false, error:value.message || 'Resend send error' };
    }
  }
  if (emailConfig.provider === 'sendgrid') {
    try {
      const require = createRequire(import.meta.url);
      const sgMail = require('@sendgrid/mail');
      if (!emailConfig.apiKey?.trim()) return { success:false, error:'SendGrid API key is not configured' };
      if (!emailConfig.fromEmail?.trim()) return { success:false, error:'SendGrid from email is not configured' };
      sgMail.setApiKey(emailConfig.apiKey);
      const result = await sgMail.send({ to: options.to, from: emailConfig.fromEmail, subject: options.subject, html: options.html, text: textContent, trackingSettings:{ clickTracking:{enable:false,enableText:false}, openTracking:{enable:false} } });
      const response = result[0];
      return response && response.statusCode >= 200 && response.statusCode < 300 ? { success:true } : { success:false, error:`SendGrid API returned status ${response?.statusCode}` };
    } catch (error: unknown) {
      const value = error as { code?: string; message?: string; response?: { body?: unknown } };
      if (value.code === 'MODULE_NOT_FOUND') return { success:false, error:'SendGrid package not installed' };
      return { success:false, error:value.response?.body ? JSON.stringify(value.response.body) : value.message || 'SendGrid API error' };
    }
  }
  if (emailConfig.provider === 'ses') {
    try {
      const require = createRequire(import.meta.url);
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
      if (!emailConfig.apiKey || !emailConfig.host || !emailConfig.fromEmail) return { success:false, error:'Amazon SES configuration incomplete' };
      const client = new SESClient({ region: emailConfig.host, credentials:{ accessKeyId:emailConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '', secretAccessKey:emailConfig.apiKey } });
      const result = await client.send(new SendEmailCommand({ Destination:{ToAddresses:[options.to]}, Message:{Body:{Html:{Charset:'UTF-8',Data:options.html},Text:{Charset:'UTF-8',Data:textContent}},Subject:{Charset:'UTF-8',Data:options.subject}}, Source:emailConfig.fromEmail }));
      logger.info('Email sent via Amazon SES', { messageId: result.MessageId });
      return { success:true };
    } catch (error: unknown) {
      const value = error as { code?: string; message?: string };
      if (value.code === 'MODULE_NOT_FOUND') return { success:false, error:'AWS SES SDK package not installed' };
      return { success:false, error:value.message || 'SES send error' };
    }
  }
  if (emailConfig.provider === 'smtp') {
    try {
      if (!emailConfig.host || !emailConfig.port || !emailConfig.user || !emailConfig.password) return { success:false, error:'SMTP configuration incomplete' };
      const info = await getSmtpTransport(emailConfig).sendMail({ from:emailConfig.fromEmail, to:options.to, subject:options.subject, html:options.html, text:textContent });
      logger.info('Email sent via SMTP', { messageId:info.messageId });
      return { success:true };
    } catch (error: unknown) {
      const value = error as { code?: string; message?: string; command?: string; response?: string };
      if (value.code === 'MODULE_NOT_FOUND') return { success:false, error:'Nodemailer package not installed' };
      return { success:false, error:[value.message || 'SMTP send error', value.code, value.command, value.response].filter(Boolean).join(' | ') };
    }
  }
  return { success:false, error:'Unknown email provider' };
}

export async function sendEmail(options: EmailOptions, providedConfig?: unknown): Promise<{ success: boolean; error?: string }> {
  try {
    const configsToTry: EmailConfig[] = providedConfig ? [providedConfig as EmailConfig] : await import('./notification-providers').then(module => module.getAllConfiguredEmailProviders());
    if (configsToTry.length === 0) return { success:false, error:'No enabled email provider configured' };
    const config = configsToTry.find(item => item.enabled && item.provider);
    if (!config) return { success:false, error:'No enabled email provider configured' };
    const result = await sendWithSingleProvider(options, config);
    if (!result.success) logger.warn('[Email] Provider delivery failed', { provider:config.provider, error:result.error });
    return result;
  } catch (error: unknown) {
    logger.error('Email send error', { component:'email', error });
    return { success:false, error:error instanceof Error ? error.message : 'Email send error' };
  }
}

type IncidentEmailData = {
  id:string; title:string; description?:string|null; status:string; urgency:string; service:{name:string}; assignee?:{name?:string|null;email?:string|null}|null; team?:{name?:string|null}|null; createdAt:Date; acknowledgedAt?:Date|null; resolvedAt?:Date|null; incidentUrl?:string;
};
function eventPresentation(eventType:'triggered'|'acknowledged'|'resolved'|'updated', urgency:string, eventMessage?:string) {
  const escalationMatch = eventMessage?.match(/Escalation Level\s+(\d+)/i);
  if (escalationMatch) return { header:`Escalation Level ${escalationMatch[1]}`, label:`Escalation Level ${escalationMatch[1]}`, message:`This incident has reached escalation level ${escalationMatch[1]} and requires responder attention.`, badge:'error' as const };
  if (eventType === 'resolved') return { header:'Incident Resolved', label:'Resolved', message:'This incident has been resolved.', badge:'success' as const };
  if (eventType === 'acknowledged') return { header:'Incident Acknowledged', label:'Acknowledged', message:'This incident has been acknowledged and is being actively worked.', badge:'warning' as const };
  if (eventType === 'updated') return { header:'Incident Updated', label:'Updated', message:'Incident details have been updated. Review the latest committed update below.', badge:'info' as const };
  return { header:urgency==='HIGH'?'Critical Incident Alert':urgency==='MEDIUM'?'Elevated Incident Alert':'Incident Notification', label:urgency==='HIGH'?'Critical Incident':urgency==='MEDIUM'?'Elevated Incident':'New Incident', message:'A new incident has been reported. Review the details and take action.', badge:urgency==='HIGH'?('error' as const):urgency==='MEDIUM'?('warning' as const):('info' as const) };
}

export function generateIncidentEmailHTML(incident:IncidentEmailData, timeZone:string='UTC', eventType:'triggered'|'acknowledged'|'resolved'|'updated'='triggered', eventMessage?:string): string {
  const presentation = eventPresentation(eventType, incident.urgency, eventMessage);
  const incidentUrl = incident.incidentUrl || `${getBaseUrl()}/incidents/${incident.id}`;
  const assigneeName = incident.assignee?.name || incident.assignee?.email || (incident.team?.name ? `${incident.team.name} (Team)` : '') || 'Unassigned';
  const infoItems = [
    { label:'Service', value:incident.service?.name || 'Service', highlight:true },
    { label:'Status', value:incident.status },
    { label:'Urgency', value:incident.urgency },
    { label:'Assignee', value:assigneeName },
    { label:'Created', value:formatDateTime(incident.createdAt,timeZone,{format:'datetime'}) },
  ];
  if (incident.acknowledgedAt) infoItems.push({ label:'Acknowledged', value:formatDateTime(incident.acknowledgedAt,timeZone,{format:'datetime'}) });
  if (incident.resolvedAt) infoItems.push({ label:'Resolved', value:formatDateTime(incident.resolvedAt,timeZone,{format:'datetime'}) });
  const context = eventMessage ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:18px 0;color:#334155;font-size:13px;">${escapeHtml(eventMessage)}</div>` : '';
  const description = incident.description ? `<div style="margin-top:22px"><h3 style="font-size:14px">Overview</h3><p style="white-space:pre-wrap;color:#4b5563">${escapeHtml(incident.description)}</p></div>` : '';
  return EmailContainer(EmailHeader(presentation.header, `Service: ${escapeHtml(incident.service?.name || 'Service')}`) + EmailContent(`
        <div style="margin-bottom:18px">${StatusBadge(presentation.label.toUpperCase(), presentation.badge)}</div>
        <div style="font-size:14px;color:#475569;margin-bottom:20px">${escapeHtml(presentation.message)}</div>
        <h2 style="font-size:22px;color:#0f172a">${escapeHtml(incident.title)}</h2>
        ${context}
        ${InfoCard(infoItems)}
        ${description}
        <div style="margin-top:24px">${EmailButton(eventType === 'resolved' ? 'View Resolution' : 'View Incident', escapeHtml(incidentUrl))}</div>
      `) + EmailFooter());
}

export async function sendIncidentEmail(userId:string, incidentId:string, eventType:'triggered'|'acknowledged'|'resolved'|'updated', notificationId?:string, durableMessage?:string): Promise<{ success:boolean; error?:string }> {
  try {
    const [user,currentIncident] = await Promise.all([
      prisma.user.findUnique({ where:{id:userId} }),
      prisma.incident.findUnique({ where:{id:incidentId}, include:{service:true,assignee:true,team:true} }),
    ]);
    if (!user || !currentIncident) return { success:false, error:'User or incident not found' };
    const envelope = decodeNotificationEnvelope(durableMessage);
    const snapshot = envelope?.snapshot;
    const eventIncident = snapshot ? {
      id:snapshot.incidentId, title:snapshot.title, description:snapshot.description, status:snapshot.status, urgency:snapshot.urgency,
      service:{name:snapshot.service.name}, assignee:snapshot.assignee, team:snapshot.team, createdAt:new Date(snapshot.createdAt),
      acknowledgedAt:snapshot.acknowledgedAt?new Date(snapshot.acknowledgedAt):null,
      resolvedAt:snapshot.resolvedAt?new Date(snapshot.resolvedAt):null,
    } : {
      ...currentIncident,
      status:eventType==='resolved'?'RESOLVED':eventType==='acknowledged'?'ACKNOWLEDGED':eventType==='triggered'?'OPEN':currentIncident.status,
      resolvedAt:eventType==='resolved'?currentIncident.resolvedAt:null,
    };
    const escalationLevel = snapshot?.escalationLevel ?? null;
    const subjectTag = escalationLevel ? `ESCALATION L${escalationLevel}` : eventType==='resolved'?'RESOLVED':eventType==='acknowledged'?'ACKNOWLEDGED':eventType==='updated'?'UPDATED':eventIncident.urgency==='HIGH'?'CRITICAL':eventIncident.urgency==='MEDIUM'?'ELEVATED':'NEW';
    const incidentUrl = `${getBaseUrl()}/incidents/${incidentId}`;
    const userTimeZone = getUserTimeZone(user ?? undefined);
    const html = generateIncidentEmailHTML({ ...eventIncident, incidentUrl }, userTimeZone, eventType, envelope?.displayMessage);
    const displayMessage = envelope?.displayMessage;
    return sendEmail({
      to:user.email,
      subject:`[${subjectTag}] ${eventIncident.title}`,
      html,
      text:`${eventIncident.title}\n\nService: ${eventIncident.service.name}\nStatus: ${eventIncident.status}\nUrgency: ${eventIncident.urgency}${displayMessage ? `\n\n${displayMessage}` : ''}\n\nView: ${incidentUrl}`,
      idempotencyKey:notificationId,
    });
  } catch (error: unknown) {
    logger.error('Send incident email error', { component:'email', error, incidentId, userId, eventType });
    return { success:false, error:error instanceof Error ? error.message : 'Send incident email error' };
  }
}
