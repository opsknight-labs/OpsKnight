/**
 * Modern Email templates for Status Page using OpsKnight Brand Colors
 * Brand Colors: Primary Red (#d32f2f), Dark (#0b0b0f), Accent Red (#ff5252)
 */

import {
  EmailContainer,
  EmailContent,
  StatusBadge,
  EmailButton,
  AlertBox,
  SubscriberEmailHeader,
  SubscriberEmailFooter,
  EmailFooter,
  escapeHtml,
} from '@/lib/email-components';

export interface EmailTemplateData {
  statusPageName: string;
  organizationName?: string;
  statusPageUrl: string;
  logoUrl?: string;
  incidentTitle?: string;
  incidentDescription?: string;
  incidentStatus?: string;
  affectedServices?: string[];
  incidentUrl?: string;
  unsubscribeUrl?: string;
}

function resolveBrandLogoUrl(
  logoUrl: string | undefined,
  statusPageUrl: string
): string | undefined {
  if (!logoUrl) return undefined;
  if (logoUrl.startsWith('http') || logoUrl.startsWith('data:')) return logoUrl;
  if (!statusPageUrl || !statusPageUrl.startsWith('http')) return logoUrl;
  try {
    const base = new URL(statusPageUrl);
    const basePath = base.pathname && base.pathname !== '/' ? base.pathname.replace(/\/$/, '') : '';
    const normalizedPath = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
    if (basePath.endsWith('/status')) {
      const prefix = `${base.origin}${basePath.slice(0, -'/status'.length)}`;
      return `${prefix}${normalizedPath}`;
    }
    const prefix = basePath ? `${base.origin}${basePath}` : base.origin;
    return `${prefix}${normalizedPath}`;
  } catch {
    return logoUrl;
  }
}

function resolveStatusPageLink(statusPageUrl: string, incidentUrl?: string): string {
  if (!incidentUrl) return statusPageUrl;
  if (incidentUrl.startsWith('http://') || incidentUrl.startsWith('https://')) {
    try {
      const statusOrigin = new URL(statusPageUrl).origin;
      const incidentOrigin = new URL(incidentUrl).origin;
      return statusOrigin === incidentOrigin ? incidentUrl : statusPageUrl;
    } catch {
      return statusPageUrl;
    }
  }
  try {
    return new URL(incidentUrl, statusPageUrl).toString();
  } catch {
    return statusPageUrl;
  }
}

/**
 * Verification Email Template
 */
export function getVerificationEmailTemplate(
  data: EmailTemplateData & { verificationUrl: string }
): { subject: string; html: string; text: string } {
  const displayName = data.organizationName || data.statusPageName;
  const safeDisplayName = escapeHtml(displayName);
  const resolvedLogoUrl = resolveBrandLogoUrl(data.logoUrl, data.statusPageUrl);
  const safeVerificationUrl = escapeHtml(data.verificationUrl);
  const subject = `[${displayName}] 🔐 Verify your subscription`;

  const content = `
        ${SubscriberEmailHeader(
          displayName,
          'Email Verification',
          'Confirm your subscription to receive status updates',
          {
            headerGradient: 'linear-gradient(135deg, #0b0b0f 0%, #111827 45%, #0f172a 100%)',
            logoUrl: resolvedLogoUrl,
            brandName: displayName,
          }
        )}
        ${EmailContent(`
            <!-- Welcome Message -->
            <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; background: rgba(16, 185, 129, 0.12); border-radius: 999px; padding: 12px 22px; margin-bottom: 20px; border: 1px solid rgba(16, 185, 129, 0.35);">
                    <span style="font-size: 32px; filter: drop-shadow(0 2px 4px rgba(16, 185, 129, 0.25));">✉️</span>
                </div>
                <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 26px; font-weight: 800; letter-spacing: -0.02em;">
                    Welcome to Status Updates!
                </h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                    You're one click away from receiving important updates about <strong style="color: #10b981;">${safeDisplayName}</strong>
                </p>
            </div>
            
            <!-- Verification Card -->
            <div style="background: linear-gradient(135deg, #0b0b0f 0%, #111827 100%); border: 1px solid #1f2937; border-radius: 16px; padding: 32px; margin: 32px 0; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.35);">
                <p style="margin: 0 0 20px 0; color: #e2e8f0; font-size: 15px; line-height: 1.7; text-align: center;">
                    To complete your subscription and start receiving notifications about incidents and status changes, please verify your email address:
                </p>
                
                ${EmailButton('Verify Email Address →', data.verificationUrl, {
                  buttonBackground: 'linear-gradient(135deg, #10b981 0%, #22c55e 100%)',
                  buttonShadow: '0 10px 24px rgba(16, 185, 129, 0.35)',
                })}
                
                <p style="margin: 24px 0 0 0; padding-top: 24px; border-top: 1px solid rgba(148, 163, 184, 0.2); color: #94a3b8; font-size: 13px; text-align: center;">
                    This link will expire in 7 days
                </p>
            </div>
            
            <!-- Alternative Link -->
            <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; font-weight: 600;">
                    Button not working?
                </p>
                <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; word-break: break-all;">
                    Copy and paste this link: <a href="${safeVerificationUrl}" style="color: #10b981; text-decoration: none;">${safeVerificationUrl}</a>
                </p>
            </div>
            
            <!-- Security Note -->
            <div style="text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; color: #9ca3af; font-size: 14px; line-height: 1.6;">
                    If you didn't subscribe to these updates, you can safely ignore this email.
                </p>
            </div>
        `)}
        ${
          data.unsubscribeUrl
            ? SubscriberEmailFooter(data.unsubscribeUrl, displayName)
            : EmailFooter()
        }
    `;

  const html = EmailContainer(content);

  const text = `
${displayName} - Verify Your Email Subscription

Thank you for subscribing to ${displayName} status updates!

To complete your subscription, please verify your email address by visiting:
${data.verificationUrl}

This verification link will expire in 7 days.

If you didn't subscribe, you can safely ignore this email.
    `.trim();

  return { subject, html, text };
}

/**
 * Incident Created Template
 */
export function getIncidentCreatedTemplate(data: EmailTemplateData): {
  subject: string;
  html: string;
  text: string;
} {
  const displayName = data.organizationName || data.statusPageName;
  const resolvedLogoUrl = resolveBrandLogoUrl(data.logoUrl, data.statusPageUrl);
  const resolvedIncidentUrl = resolveStatusPageLink(data.statusPageUrl, data.incidentUrl);
  const safeAffectedServices = data.affectedServices?.map(service => escapeHtml(service)) || [];
  const subject = `[${displayName}] 🚨 Incident: ${data.incidentTitle || 'New Incident'}`;

  const content = `
        ${SubscriberEmailHeader(
          displayName,
          'Incident Reported',
          data.incidentTitle || 'New Incident',
          {
            headerGradient: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%)',
            logoUrl: resolvedLogoUrl,
            brandName: displayName,
          }
        )}
        ${EmailContent(`
            <!-- Status Badge -->
            <div style="text-align: center; margin-bottom: 32px;">
                ${StatusBadge('INCIDENT REPORTED', 'error')}
            </div>
            
            <!-- Alert Box -->
            ${AlertBox(
              data.incidentTitle || 'New Incident',
              data.incidentDescription ||
                'An incident has been reported and our team is investigating.',
              'error'
            )}
            
            ${
              safeAffectedServices.length > 0
                ? `
            <!-- Affected Services -->
            <div style="margin: 32px 0;">
                <h3 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; font-weight: 700;">
                    Affected Services
                </h3>
                <div style="background: linear-gradient(135deg, #fff1f2 0%, #fee2e2 100%); border: 1px solid #fecaca; border-radius: 12px; padding: 24px;">
                    ${safeAffectedServices
                      .map(
                        service => `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(239, 68, 68, 0.1); last-child:border-bottom: none;">
                            <div style="width: 10px; height: 10px; background: #dc2626; border-radius: 50%; box-shadow: 0 0 8px rgba(220, 38, 38, 0.4);"></div>
                            <span style="color: #111827; font-size: 15px; font-weight: 600;">${service}</span>
                        </div>
                    `
                      )
                      .join('')}
                </div>
            </div>
            `
                : ''
            }
            
            <!-- Call to Action -->
            ${EmailButton('View Incident Details →', resolvedIncidentUrl, {
              buttonBackground: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
              buttonShadow: '0 10px 22px rgba(185, 28, 28, 0.35)',
            })}
            
            <!-- Status Updates Info -->
            <div style="margin-top: 40px; padding: 24px; background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border-radius: 12px; text-align: center; border: 1px solid #fed7aa;">
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.7;">
                    💡 We'll keep you updated on the progress. Check the status page for real-time updates.
                </p>
            </div>
        `)}
        ${
          data.unsubscribeUrl
            ? SubscriberEmailFooter(data.unsubscribeUrl, displayName)
            : EmailFooter()
        }
    `;

  const html = EmailContainer(content);

  const text = `
${displayName} - New Incident Reported

${data.incidentTitle || 'New Incident'}

${data.incidentDescription || ''}

${data.affectedServices && data.affectedServices.length > 0 ? `Affected Services:\n${data.affectedServices.map(s => `- ${s}`).join('\n')}\n\n` : ''}
View incident details: ${resolvedIncidentUrl}

---
You're receiving this because you subscribed to ${displayName} status updates.
${data.unsubscribeUrl ? `Unsubscribe: ${data.unsubscribeUrl}` : ''}
    `.trim();

  return { subject, html, text };
}

/**
 * Incident Resolved Template
 */
export function getIncidentResolvedTemplate(data: EmailTemplateData): {
  subject: string;
  html: string;
  text: string;
} {
  const displayName = data.organizationName || data.statusPageName;
  const resolvedLogoUrl = resolveBrandLogoUrl(data.logoUrl, data.statusPageUrl);
  const resolvedIncidentUrl = resolveStatusPageLink(data.statusPageUrl, data.incidentUrl);
  const subject = `[${displayName}] ✅ Resolved: ${data.incidentTitle || 'Incident'}`;

  const content = `
        ${SubscriberEmailHeader(
          displayName,
          'Incident Resolved',
          data.incidentTitle || 'Incident',
          {
            headerGradient: 'linear-gradient(135deg, #166534 0%, #16a34a 45%, #22c55e 100%)',
            logoUrl: resolvedLogoUrl,
            brandName: displayName,
          }
        )}
        ${EmailContent(`
            <!-- Status Badge -->
            <div style="text-align: center; margin-bottom: 32px;">
                ${StatusBadge('RESOLVED', 'success')}
            </div>
            
            <!-- Success Icon -->
            <div style="text-align: center; margin: 40px 0;">
                <div style="display: inline-block; width: 96px; height: 96px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-radius: 50%; box-shadow: 0 12px 32px rgba(22, 163, 74, 0.35), 0 0 0 8px rgba(34, 197, 94, 0.12); display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 56px; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));">✓</span>
                </div>
            </div>
            
            <!-- Alert Box -->
            ${AlertBox(
              data.incidentTitle || 'All Systems Operational',
              data.incidentDescription ||
                'The incident has been resolved and all systems are back to normal operation.',
              'success'
            )}
            
            <!-- Success Message -->
            <div style="text-align: center; margin: 32px 0; padding: 28px; background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); border-radius: 12px; border: 1px solid #86efac;">
                <p style="margin: 0; color: #166534; font-size: 16px; font-weight: 600; line-height: 1.6;">
                    🎉 Everything is back up and running smoothly!
                </p>
                <p style="margin: 12px 0 0 0; color: #15803d; font-size: 14px; line-height: 1.6;">
                    Thank you for your patience while we resolved this issue.
                </p>
            </div>
            
            ${EmailButton('View Status Page →', data.statusPageUrl, {
              buttonBackground: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
              buttonShadow: '0 10px 22px rgba(22, 163, 74, 0.35)',
            })}
        `)}
        ${
          data.unsubscribeUrl
            ? SubscriberEmailFooter(data.unsubscribeUrl, displayName)
            : EmailFooter()
        }
    `;

  const html = EmailContainer(content);

  const text = `
${displayName} - Incident Resolved

${data.incidentTitle || 'Incident'} has been resolved.

${data.incidentDescription || ''}

All systems are back to normal operation. Thank you for your patience.

View status page: ${resolvedIncidentUrl}

---
You're receiving this because you subscribed to ${displayName} status updates.
${data.unsubscribeUrl ? `Unsubscribe: ${data.unsubscribeUrl}` : ''}
    `.trim();

  return { subject, html, text };
}

/**
 * Status Change Template
 */
export function getStatusChangeTemplate(data: EmailTemplateData): {
  subject: string;
  html: string;
  text: string;
} {
  const displayName = data.organizationName || data.statusPageName;
  const resolvedLogoUrl = resolveBrandLogoUrl(data.logoUrl, data.statusPageUrl);
  const safeIncidentStatus = escapeHtml(data.incidentStatus || 'Updated');
  const safeIncidentDescription = data.incidentDescription
    ? escapeHtml(data.incidentDescription)
    : '';
  const subject = `[${displayName}] 🔄 Status Update`;

  const content = `
        ${SubscriberEmailHeader(displayName, 'Status Update', data.incidentStatus || 'Updated', {
          headerGradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)',
          logoUrl: resolvedLogoUrl,
          brandName: displayName,
        })}
        ${EmailContent(`
            <h2 style="margin: 0 0 24px 0; color: #111827; font-size: 24px; font-weight: 700;">
                Status Change Notification
            </h2>

            <div style="text-align: left; margin-bottom: 16px;">
                ${StatusBadge((data.incidentStatus || 'Updated').toUpperCase(), 'info')}
            </div>
            
            <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 24px; margin: 24px 0; border-radius: 12px; border-left: 4px solid #2563eb;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                    Current Status
                </p>
                <p style="margin: 0; color: #111827; font-size: 18px; font-weight: 700;">
                    ${safeIncidentStatus}
                </p>
            </div>
            
            ${
              safeIncidentDescription
                ? `
            <div style="margin: 24px 0;">
                <p style="margin: 0; color: #374151; font-size: 15px; line-height: 1.7;">
                    ${safeIncidentDescription}
                </p>
            </div>
            `
                : ''
            }
            
            ${EmailButton('View Full Status →', data.statusPageUrl, {
              buttonBackground: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
              buttonShadow: '0 10px 22px rgba(37, 99, 235, 0.35)',
            })}
        `)}
        ${
          data.unsubscribeUrl
            ? SubscriberEmailFooter(data.unsubscribeUrl, displayName)
            : EmailFooter()
        }
    `;

  const html = EmailContainer(content);

  const text = `
${displayName} - Status Update

Status: ${data.incidentStatus || 'Updated'}

${data.incidentDescription || ''}

View status page: ${data.statusPageUrl}

---
You're receiving this because you subscribed to ${displayName} status updates.
${data.unsubscribeUrl ? `Unsubscribe: ${data.unsubscribeUrl}` : ''}
    `.trim();

  return { subject, html, text };
}
