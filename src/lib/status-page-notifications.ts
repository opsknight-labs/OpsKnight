import prisma from '@/lib/prisma';
import { getStatusPageEmailConfig } from '@/lib/notification-providers';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { getStatusPageLogoUrl, getStatusPagePublicUrl } from '@/lib/status-page-url';
import {
  buildSubscriberIncidentPresentation,
  incidentSubscriberDeliveryKey,
} from '@/lib/status-page-delivery';
import {
  EmailContainer,
  EmailContent,
  SubscriberEmailHeader,
  SubscriberEmailFooter,
  EmailButton,
  escapeHtml,
} from '@/lib/email-components';

export async function notifyStatusPageSubscribers(
  incidentId: string,
  eventType:
    | 'check'
    | 'investigating'
    | 'identified'
    | 'monitoring'
    | 'resolved'
    | 'scheduled'
    | 'inprogress'
    | 'completed'
    | 'triggered'
    | 'acknowledged'
    | 'snoozed'
    | 'suppressed',
  deliveryKey?: string
): Promise<{ success: boolean; sent: number; failed: number; skipped?: boolean }> {
  let totalSent = 0;
  let totalFailed = 0;
  try {
    // 1. Get incident details with service
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: true,
      },
    });

    if (!incident) {
      logger.error(`Incident ${incidentId} not found for status page notifications`);
      return { success: true, sent: 0, failed: 0, skipped: true };
    }

    if (incident.visibility && incident.visibility !== 'PUBLIC') {
      logger.info(
        `Incident ${incidentId} has non-public visibility (${incident.visibility}). Skipping public status page notifications.`
      );
      return { success: true, sent: 0, failed: 0, skipped: true };
    }

    const effectiveDeliveryKey = incidentSubscriberDeliveryKey(incident, eventType, deliveryKey);

    // 2. Find all status pages that include this service
    const statusPages = await prisma.statusPage.findMany({
      where: {
        enabled: true,
        showIncidents: true,
        services: {
          some: {
            serviceId: incident.serviceId,
            showOnPage: true,
          },
        },
      },
      include: {
        subscriptions: {
          where: {
            verified: true,
            unsubscribedAt: null,
          },
        },
      },
    });

    if (statusPages.length === 0) {
      logger.info(
        `No status pages found displaying service ${incident.serviceId} for incident ${incidentId}`
      );
      return { success: true, sent: 0, failed: 0, skipped: true };
    }

    logger.info(`Found ${statusPages.length} status pages for incident ${incidentId}`);

    const appBaseUrl = getBaseUrl();

    // 3. Batch fetch all email configs upfront (avoids N+1 query pattern)
    const pagesWithSubscribers = statusPages.filter(p => p.subscriptions.length > 0);
    const emailConfigs = await Promise.all(
      pagesWithSubscribers.map(page => getStatusPageEmailConfig(page.id))
    );
    const emailConfigMap = new Map(
      pagesWithSubscribers.map((page, idx) => [page.id, emailConfigs[idx]])
    );

    // 4. Send notifications for each status page
    for (const page of pagesWithSubscribers) {
      const emailConfig = emailConfigMap.get(page.id);
      if (!emailConfig?.enabled) {
        logger.warn(`Email not configured for status page ${page.name} (${page.id})`);
        continue;
      }

      const displayName = (page as any).organizationName || page.name; // eslint-disable-line @typescript-eslint/no-explicit-any
      const branding =
        page.branding && typeof page.branding === 'object' && !Array.isArray(page.branding)
          ? (page.branding as Record<string, unknown>)
          : {};
      const statusPageUrl = getStatusPagePublicUrl(page, appBaseUrl);
      const rawLogoUrl = typeof branding.logoUrl === 'string' ? branding.logoUrl : undefined;
      const logoUrl =
        rawLogoUrl && rawLogoUrl.startsWith('data:image/')
          ? getStatusPageLogoUrl(page, page.id, appBaseUrl)
          : rawLogoUrl;
      const brandLogoUrl = resolveBrandLogoUrl(logoUrl, statusPageUrl);
      const safeBrandLogoUrl = brandLogoUrl ? escapeHtml(brandLogoUrl) : undefined;
      const presentation = buildSubscriberIncidentPresentation(page, incident);
      const subject = formatSubject(displayName, presentation.incident.title, eventType);
      const html = formatEmailBody(
        displayName,
        presentation.incident,
        eventType,
        statusPageUrl,
        page.contactUrl,
        safeBrandLogoUrl,
        {
          showAffectedService: presentation.showAffectedService,
          showDescription: presentation.showDescription,
          showTimestamp: presentation.showTimestamp,
        }
      );

      logger.info(
        `Sending notifications to ${page.subscriptions.length} subscribers for page ${page.name}`
      );

      const BATCH_SIZE = 25;
      let sent = 0;
      let failed = 0;

      for (let i = 0; i < page.subscriptions.length; i += BATCH_SIZE) {
        const batch = page.subscriptions.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async sub => {
            const intent = await enqueueCentralNotification({
              category: 'STATUS_PAGE',
              channel: 'EMAIL',
              recipientType: 'SUBSCRIBER',
              recipientId: sub.id,
              recipientAddress: sub.email,
              incidentId,
              templateKey: `status-page-incident-${eventType}`,
              sourceType: 'STATUS_PAGE_INCIDENT',
              sourceId: `${page.id}:${incidentId}`,
              eventKey: effectiveDeliveryKey,
              displayMessage: subject,
              priority: eventType === 'resolved' ? 3 : 1,
              payload: {
                kind: 'EMAIL',
                to: sub.email,
                subject,
                html: html.replaceAll(
                  '{{unsubscribe_url}}',
                  `${appBaseUrl}/status/unsubscribe/${sub.token}`
                ),
                providerScope: { statusPageId: page.id },
              },
            });
            return { success: true, skipped: !intent.created };
          })
        );

        sent += results.filter(
          r => r.status === 'fulfilled' && r.value.success && !r.value.skipped
        ).length;
        failed += results.filter(
          r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
        ).length;
      }

      logger.info(`Status page notifications sent: ${sent} success, ${failed} failed`);
      totalSent += sent;
      totalFailed += failed;
    }
    return { success: totalFailed === 0, sent: totalSent, failed: totalFailed };
  } catch (error) {
    logger.error('Failed to notify status page subscribers', {
      error: error instanceof Error ? error.message : 'Unknown error',
      incidentId,
    });
    return { success: false, sent: totalSent, failed: totalFailed + 1 };
  }
}

function formatSubject(pageName: string, incidentTitle: string, eventType: string): string {
  const prefix = `[${pageName}]`;
  const statusMap: Record<string, string> = {
    triggered: 'New Incident',
    acknowledged: 'Investigating',
    resolved: 'Resolved',
    investigating: 'Investigating',
    identified: 'Identified',
    monitoring: 'Monitoring',
    completed: 'Completed',
  };

  return `${prefix} ${statusMap[eventType] || 'Update'}: ${incidentTitle}`;
}

function resolveBrandLogoUrl(logoUrl: string | undefined, baseUrl: string): string | undefined {
  if (!logoUrl) return undefined;
  if (logoUrl.startsWith('http') || logoUrl.startsWith('data:')) return logoUrl;
  if (!baseUrl || !baseUrl.startsWith('http')) return logoUrl;
  try {
    const parsed = new URL(baseUrl);
    const basePath =
      parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    const normalizedPath = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
    if (basePath.endsWith('/status')) {
      const prefix = `${parsed.origin}${basePath.slice(0, -'/status'.length)}`;
      return `${prefix}${normalizedPath}`;
    }
    const prefix = basePath ? `${parsed.origin}${basePath}` : parsed.origin;
    return `${prefix}${normalizedPath}`;
  } catch {
    const normalizedBase = baseUrl.replace(/\/$/, '');
    const normalizedPath = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}

function normalizeSupportUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:')
  ) {
    return trimmed;
  }
  return undefined;
}

function formatEmailBody(
  pageName: string,
  incident: any,
  eventType: string,
  statusPageUrl: string,
  contactUrl?: string | null,
  logoUrl?: string,
  privacy: {
    showAffectedService: boolean;
    showDescription: boolean;
    showTimestamp: boolean;
  } = { showAffectedService: true, showDescription: true, showTimestamp: true }
): string {
  const statusMap: Record<
    string,
    { label: string; badge: 'success' | 'warning' | 'error' | 'info' }
  > = {
    triggered: { label: 'New Incident', badge: 'error' },
    acknowledged: { label: 'Investigating', badge: 'warning' },
    resolved: { label: 'Resolved', badge: 'success' },
    investigating: { label: 'Investigating', badge: 'warning' },
    identified: { label: 'Identified', badge: 'warning' },
    monitoring: { label: 'Monitoring', badge: 'info' },
    completed: { label: 'Maintenance Completed', badge: 'success' },
    scheduled: { label: 'Maintenance Scheduled', badge: 'info' },
    inprogress: { label: 'In Progress', badge: 'warning' },
  };

  const statusInfo = statusMap[eventType] || { label: 'Update', badge: 'info' };
  const safePageName = escapeHtml(pageName);
  const safeIncidentTitle = escapeHtml(incident.title || 'Incident Update');
  const safeServiceName = escapeHtml(incident.service?.name || 'Service');
  const safeDescription = incident.description
    ? escapeHtml(incident.description)
    : 'Additional incident details are not published.';
  const safeStatusPageUrl = escapeHtml(statusPageUrl);
  const supportUrl = normalizeSupportUrl(contactUrl);
  const safeSupportUrl = supportUrl ? escapeHtml(supportUrl) : '';
  const safeStatusLabel = escapeHtml(statusInfo.label);

  const headerGradients: Record<string, string> = {
    success: 'linear-gradient(135deg, #166534 0%, #16a34a 45%, #22c55e 100%)',
    warning: 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #f59e0b 100%)',
    error: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%)',
    info: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)',
  };
  const buttonThemes: Record<string, { background: string; shadow: string }> = {
    success: {
      background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
      shadow: '0 10px 22px rgba(22, 163, 74, 0.35)',
    },
    warning: {
      background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
      shadow: '0 10px 22px rgba(217, 119, 6, 0.35)',
    },
    error: {
      background: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
      shadow: '0 10px 22px rgba(185, 28, 28, 0.35)',
    },
    info: {
      background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
      shadow: '0 10px 22px rgba(37, 99, 235, 0.35)',
    },
  };

  const header = SubscriberEmailHeader(safePageName, safeStatusLabel, safeIncidentTitle, {
    headerGradient: headerGradients[statusInfo.badge] || headerGradients.info,
    logoUrl,
    brandName: safePageName,
  });

  let contentBody = '';
  if (privacy.showAffectedService) {
    contentBody += `
        <div style="margin-bottom: 24px;">
            <p style="font-size: 16px; color: #4b5563; margin-bottom: 8px; font-weight: 500;">
                Affecting Service:
            </p>
            <h2 style="font-size: 20px; color: #1f2937; margin: 0; font-weight: 700;">
                ${safeServiceName}
            </h2>
        </div>`;
  }

  contentBody += `
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; border: 1px solid #e5e7eb; margin-bottom: 32px;">
            <h3 style="font-size: 14px; text-transform: uppercase; color: #6b7280; margin: 0 0 12px 0; letter-spacing: 0.05em; font-weight: 600;">
                Update Details
            </h3>
            <p style="font-size: 16px; line-height: 1.6; color: #374151; margin: 0; white-space: pre-wrap;">
                ${privacy.showDescription ? safeDescription : 'Additional incident details are not published.'}
            </p>
            ${
              privacy.showTimestamp
                ? `<p style="font-size: 14px; color: #9ca3af; margin-top: 16px; font-style: italic;">
                Posted on ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>`
                : ''
            }
        </div>
    `;

  const buttonTheme = buttonThemes[statusInfo.badge] || buttonThemes.info;
  contentBody += EmailButton('View Status Page', safeStatusPageUrl, {
    buttonBackground: buttonTheme.background,
    buttonShadow: buttonTheme.shadow,
  });

  if (supportUrl) {
    contentBody += `
        <div style="text-align: center; margin-top: 24px;">
            <a href="${safeSupportUrl}" style="color: #6b7280; font-size: 14px; text-decoration: none;">Contact Support</a>
        </div>`;
  } else {
    contentBody += `
        <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
            <span style="color: #9ca3af; font-weight: 600;">Contact support via your usual channels.</span>
        </div>`;
  }

  const body = EmailContent(contentBody);
  const footer = SubscriberEmailFooter('{{unsubscribe_url}}', safePageName);

  return EmailContainer(header + body + footer);
}

export async function notifyStatusPageSubscribersAnnouncement(
  announcementId: string,
  statusPageId: string
) {
  try {
    // 1. Get announcement details
    const announcement = await prisma.statusPageAnnouncement.findUnique({
      where: { id: announcementId },
    });

    if (!announcement) {
      logger.error(`Announcement ${announcementId} not found for status page notifications`);
      return;
    }

    // 2. Get status page with subscribers
    const page = await prisma.statusPage.findUnique({
      where: { id: statusPageId },
      include: {
        subscriptions: {
          where: {
            verified: true,
            unsubscribedAt: null,
          },
        },
      },
    });

    if (!page) {
      logger.error(`Status page ${statusPageId} not found for announcement notifications`);
      return;
    }

    if (page.subscriptions.length === 0) {
      logger.info(`No subscribers found for status page ${page.name}`);
      return;
    }

    const appBaseUrl = getBaseUrl();

    // 3. Get email config
    const emailConfig = await getStatusPageEmailConfig(page.id);
    if (!emailConfig.enabled) {
      logger.warn(`Email not configured for status page ${page.name} (${page.id})`);
      return;
    }

    // 4. Prepare email content
    const displayName = (page as any).organizationName || page.name; // eslint-disable-line @typescript-eslint/no-explicit-any
    const branding =
      page.branding && typeof page.branding === 'object' && !Array.isArray(page.branding)
        ? (page.branding as Record<string, unknown>)
        : {};
    const statusPageUrl = getStatusPagePublicUrl(page, appBaseUrl);
    const rawLogoUrl = typeof branding.logoUrl === 'string' ? branding.logoUrl : undefined;
    const logoUrl =
      rawLogoUrl && rawLogoUrl.startsWith('data:image/')
        ? getStatusPageLogoUrl(page, page.id, appBaseUrl)
        : rawLogoUrl;
    const brandLogoUrl = resolveBrandLogoUrl(logoUrl, statusPageUrl);
    const safeBrandLogoUrl = brandLogoUrl ? escapeHtml(brandLogoUrl) : undefined;
    const safeDisplayName = escapeHtml(displayName);
    const safeAnnouncementTitle = escapeHtml(announcement.title || 'Announcement');
    const safeAnnouncementMessage = escapeHtml(announcement.message || '');

    const themes: Record<
      string,
      { label: string; color: string; bg: string; borderColor: string }
    > = {
      INCIDENT: { label: 'Incident', color: '#dc2626', bg: '#fef2f2', borderColor: '#fecaca' },
      MAINTENANCE: {
        label: 'Maintenance',
        color: '#2563eb',
        bg: '#eff6ff',
        borderColor: '#bfdbfe',
      },
      UPDATE: { label: 'Update', color: '#059669', bg: '#ecfdf5', borderColor: '#a7f3d0' },
      WARNING: { label: 'Warning', color: '#d97706', bg: '#fffbeb', borderColor: '#fde68a' },
      INFO: { label: 'Information', color: '#4b5563', bg: '#f9fafb', borderColor: '#e5e7eb' },
    };

    const theme = themes[announcement.type as string] || themes['INFO'];
    const subject = `[${displayName}] ${theme.label}: ${announcement.title}`;

    let html = '';

    const announcementHeader = SubscriberEmailHeader(
      safeDisplayName,
      escapeHtml(theme.label),
      safeAnnouncementTitle,
      {
        headerGradient:
          announcement.type === 'INCIDENT'
            ? 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%)'
            : announcement.type === 'MAINTENANCE'
              ? 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)'
              : announcement.type === 'UPDATE'
                ? 'linear-gradient(135deg, #166534 0%, #16a34a 45%, #22c55e 100%)'
                : announcement.type === 'WARNING'
                  ? 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #f59e0b 100%)'
                  : 'linear-gradient(135deg, #8b1a1a 0%, #b91c1c 40%, #c92a2a 70%, #dc2626 100%)',
        logoUrl: safeBrandLogoUrl,
        brandName: safeDisplayName,
      }
    );

    const contentBody = `
            <div style="background: ${theme.bg}; border-radius: 12px; padding: 24px; border: 1px solid ${theme.borderColor}; margin-bottom: 32px;">
                <h3 style="font-size: 14px; text-transform: uppercase; color: ${theme.color}; margin: 0 0 12px 0; letter-spacing: 0.05em; font-weight: 700;">
                    ${escapeHtml(theme.label)} Details
                </h3>
                <p style="font-size: 16px; line-height: 1.6; color: #374151; margin: 0; white-space: pre-wrap;">
                    ${safeAnnouncementMessage}
                </p>
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid ${theme.borderColor}; display: flex; gap: 24px; color: #6b7280; font-size: 14px;">
                    <div>
                        <span style="font-weight: 600; color: ${theme.color};">Start:</span> ${new Date(announcement.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    ${
                      announcement.endDate
                        ? `
                    <div>
                        <span style="font-weight: 600; color: ${theme.color};">End:</span> ${new Date(announcement.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    `
                        : ''
                    }
                </div>
                <p style="font-size: 14px; color: #9ca3af; margin-top: 16px; font-style: italic;">
                    Posted on ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
            </div>
            <div style="text-align: center; margin-top: 32px;">
                <a href="${escapeHtml(statusPageUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">View Status Page</a>
            </div>
        `;

    const body = EmailContent(contentBody);
    const footer = SubscriberEmailFooter('{{unsubscribe_url}}', safeDisplayName);

    html = EmailContainer(announcementHeader + body + footer);

    logger.info(
      `Sending announcement notifications to ${page.subscriptions.length} subscribers for page ${page.name}`
    );

    const BATCH_SIZE = 25;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < page.subscriptions.length; i += BATCH_SIZE) {
      const batch = page.subscriptions.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async sub => {
          const intent = await enqueueCentralNotification({
            category: 'STATUS_PAGE',
            channel: 'EMAIL',
            recipientType: 'SUBSCRIBER',
            recipientId: sub.id,
            recipientAddress: sub.email,
            templateKey: 'status-page-announcement',
            sourceType: 'STATUS_PAGE_ANNOUNCEMENT',
            sourceId: announcement.id,
            eventKey: announcement.updatedAt.toISOString(),
            displayMessage: subject,
            priority: announcement.type === 'INCIDENT' ? 1 : 4,
            payload: {
              kind: 'EMAIL',
              to: sub.email,
              subject,
              html: html.replaceAll(
                '{{unsubscribe_url}}',
                `${appBaseUrl}/status/unsubscribe/${sub.token}`
              ),
              providerScope: { statusPageId: page.id },
            },
          });
          return { success: true, skipped: !intent.created };
        })
      );

      sent += results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      failed += results.filter(
        r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      ).length;
    }

    logger.info(`Status announcement notifications sent: ${sent} success, ${failed} failed`);
  } catch (error) {
    logger.error('Failed to notify status page subscribers about announcement', {
      error: error instanceof Error ? error.message : 'Unknown error',
      announcementId,
    });
  }
}
