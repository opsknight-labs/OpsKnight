import prisma from '@/lib/prisma';
import { NOTIFICATION_PRIORITY, statusNotificationPriority } from '@/lib/notification-priority';
import { issueUnsubscribeTokensBatch } from '@/lib/status-pages/subscription-tokens';
import { getStatusPageEmailConfig } from '@/lib/notification-providers';
import { createCentralNotificationIntentsBatch } from '@/lib/notification-control-plane';
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
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import {
  beginNotificationFanout,
  BulkQueueBackpressureError,
  bulkQueueHasCapacity,
  recordFanoutPage,
} from '@/lib/notification-fanout';
import { formatDateTime, isValidTimeZone } from '@/lib/timezone';
import {
  announcementGenerationEventKey,
  readAnnouncementNotificationGeneration,
} from '@/lib/status-pages/announcement-notification-generation';
import type { AnnouncementFanoutDeliveryMode } from '@/lib/status-pages/announcement-fanout-contract';
import { selectAnnouncementRecipientsNeedingReplacement } from '@/lib/status-pages/announcement-recipient-reconciliation';

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
    });

    if (statusPages.length === 0) {
      logger.info(
        `No status pages found displaying service ${incident.serviceId} for incident ${incidentId}`
      );
      return { success: true, sent: 0, failed: 0, skipped: true };
    }

    logger.info(`Found ${statusPages.length} status pages for incident ${incidentId}`);

    const appBaseUrl = getBaseUrl();
    const emailConfigEntries = await Promise.all(
      statusPages.map(async page => [page.id, await getStatusPageEmailConfig(page.id)] as const)
    );
    const emailConfigMap = new Map(emailConfigEntries);

    for (const page of statusPages) {
      const emailConfig = emailConfigMap.get(page.id);
      if (!emailConfig?.enabled) {
        logger.warn(`Email not configured for status page ${page.name} (${page.id})`);
        continue;
      }

      const displayName = page.organizationName || page.name;
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

      const PAGE_SIZE = 500;
      const policy = statusNotificationPriority(eventType);
      const fanout = await beginNotificationFanout({
        statusPageId: page.id,
        sourceType: 'STATUS_PAGE_INCIDENT',
        sourceId: incidentId,
        eventKey: effectiveDeliveryKey,
        trafficClass: policy.trafficClass,
        providerKey: emailConfig.provider || undefined,
        subject,
        html,
      });
      let sent = 0;
      let failed = 0;
      let cursor: string | undefined = fanout.cursor ?? undefined;

      while (true) {
        if (!(await bulkQueueHasCapacity())) {
          throw new BulkQueueBackpressureError();
        }
        const subscriptions: Array<{ id: string; email: string; token: string }> =
          await prisma.statusPageSubscription.findMany({
            where: {
              statusPageId: page.id,
              state: 'ACTIVE',
              verified: true,
              unsubscribedAt: null,
              OR: [
                { selectedServices: { none: {} } },
                { selectedServices: { some: { serviceId: incident.serviceId } } },
              ],
            },
            orderBy: { id: 'asc' },
            take: PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, email: true, token: true },
          });
        if (subscriptions.length === 0) {
          await recordFanoutPage(fanout.id, {
            cursor,
            materialized: 0,
            failed: 0,
            complete: true,
          });
          break;
        }
        const eligible = subscriptions;
        const unsubscribeTokens = await issueUnsubscribeTokensBatch(
          eligible.map(subscription => subscription.id)
        );
        let pageSent = 0;
        let pageFailed = 0;
        let pageError: unknown;

        try {
          const result = await createCentralNotificationIntentsBatch(
            eligible.map(sub => ({
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
              ...policy,
              contentId: fanout.contentId,
              fanoutId: fanout.id,
              payload: {
                kind: 'EMAIL',
                providerKey: emailConfig.provider || undefined,
                to: sub.email,
                subject,
                contentId: fanout.contentId,
                unsubscribeUrl: `${statusPageUrl}/unsubscribe/${unsubscribeTokens.get(sub.id)}`,
                providerScope: {
                  statusPageId: page.id,
                  subscriptionId: sub.id,
                  incidentId,
                  eventType,
                  expectedStatus: incident.status,
                  escalationGeneration: incident.escalationGeneration,
                },
              },
            }))
          );
          pageSent = result.created;
        } catch (error) {
          pageFailed = eligible.length;
          pageError = error;
          logger.error('status_page.incident_fanout_page_failed', {
            statusPageId: page.id,
            incidentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        sent += pageSent;
        failed += pageFailed;
        if (pageFailed > 0) {
          throw new Error(
            `Failed to materialize ${pageFailed} notification intents; retrying page: ${pageError instanceof Error ? pageError.message : String(pageError)}`
          );
        }
        cursor = subscriptions.at(-1)?.id;
        if (cursor) {
          await recordFanoutPage(fanout.id, {
            cursor,
            materialized: pageSent,
            failed: pageFailed,
            complete: subscriptions.length < PAGE_SIZE,
          });
        }
        if (subscriptions.length < PAGE_SIZE || !cursor) break;
      }

      logger.info(`Status page notifications enqueued: ${sent} success, ${failed} failed`);
      totalSent += sent;
      totalFailed += failed;
    }
    addOperationalMetric('opsknight_status_page_fanout_total', totalSent, {
      event: 'incident',
      outcome: 'enqueued',
    });
    addOperationalMetric('opsknight_status_page_fanout_total', totalFailed, {
      event: 'incident',
      outcome: 'failed',
    });
    return { success: totalFailed === 0, sent: totalSent, failed: totalFailed };
  } catch (error) {
    if (error instanceof BulkQueueBackpressureError) {
      addOperationalMetric('opsknight_status_fanout_campaign_total', 1, { outcome: 'backpressured' });
    }
    logger.error('Failed to notify status page subscribers', {
      error: error instanceof Error ? error.message : 'Unknown error',
      incidentId,
      backpressured: error instanceof BulkQueueBackpressureError,
    });
    if (error instanceof BulkQueueBackpressureError) throw error;
    return { success: false, sent: totalSent, failed: totalFailed + 1 };
  }
}

function formatSubject(pageName: string, incidentTitle: string, eventType: string): string {
  const prefix = `[${pageName}]`;
  const label =
    eventType === 'triggered'
      ? 'New Incident'
      : eventType === 'acknowledged' || eventType === 'investigating'
        ? 'Investigating'
        : eventType === 'resolved'
          ? 'Resolved'
          : eventType === 'identified'
            ? 'Identified'
            : eventType === 'monitoring'
              ? 'Monitoring'
              : eventType === 'completed'
                ? 'Completed'
                : 'Update';
  return `${prefix} ${label}: ${incidentTitle}`;
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
  incident: {
    title?: string | null;
    description?: string | null;
    service?: { name?: string | null } | null;
  },
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
  const statusInfo = new Map<
    string,
    { label: string; badge: 'success' | 'warning' | 'error' | 'info' }
  >([
    ['triggered', { label: 'New Incident', badge: 'error' }],
    ['acknowledged', { label: 'Investigating', badge: 'warning' }],
    ['resolved', { label: 'Resolved', badge: 'success' }],
    ['investigating', { label: 'Investigating', badge: 'warning' }],
    ['identified', { label: 'Identified', badge: 'warning' }],
    ['monitoring', { label: 'Monitoring', badge: 'info' }],
    ['completed', { label: 'Maintenance Completed', badge: 'success' }],
    ['scheduled', { label: 'Maintenance Scheduled', badge: 'info' }],
    ['inprogress', { label: 'In Progress', badge: 'warning' }],
  ]).get(eventType) ?? { label: 'Update', badge: 'info' as const };
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

  const headerGradient =
    statusInfo.badge === 'success'
      ? headerGradients.success
      : statusInfo.badge === 'warning'
        ? headerGradients.warning
        : statusInfo.badge === 'error'
          ? headerGradients.error
          : headerGradients.info;
  const header = SubscriberEmailHeader(safePageName, safeStatusLabel, safeIncidentTitle, {
    headerGradient,
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

  const buttonTheme =
    statusInfo.badge === 'success'
      ? buttonThemes.success
      : statusInfo.badge === 'warning'
        ? buttonThemes.warning
        : statusInfo.badge === 'error'
          ? buttonThemes.error
          : buttonThemes.info;
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
  statusPageId: string,
  notificationGeneration: number,
  deliveryMode: AnnouncementFanoutDeliveryMode = 'ALL_ELIGIBLE'
): Promise<{ sent: number; failed: number; skipped?: boolean }> {
  try {
    const announcement = await prisma.statusPageAnnouncement.findFirst({
      where: { id: announcementId, statusPageId },
    });

    if (!announcement) {
      logger.error(`Announcement ${announcementId} not found for status page notifications`);
      return { sent: 0, failed: 0, skipped: true };
    }

    const currentGeneration = await readAnnouncementNotificationGeneration(
      announcementId,
      statusPageId
    );
    if (currentGeneration !== notificationGeneration) {
      logger.info('status_page.announcement_fanout_stale_generation', {
        announcementId,
        statusPageId,
        expectedGeneration: notificationGeneration,
        currentGeneration,
      });
      return { sent: 0, failed: 0, skipped: true };
    }

    if (!announcement.isActive || announcement.notificationTiming === 'NONE') {
      logger.info(`Announcement ${announcementId} is inactive/withdrawn; skipping notification fan-out`);
      return { sent: 0, failed: 0, skipped: true };
    }

    if (announcement.publishAt && announcement.publishAt.getTime() > Date.now()) {
      logger.info(`Announcement ${announcementId} publishAt is in the future; skipping notification fan-out`);
      return { sent: 0, failed: 0, skipped: true };
    }

    const page = await prisma.statusPage.findUnique({
      where: { id: statusPageId },
    });

    if (!page) {
      logger.error(`Status page ${statusPageId} not found for announcement notifications`);
      return { sent: 0, failed: 0, skipped: true };
    }

    const appBaseUrl = getBaseUrl();
    const emailConfig = await getStatusPageEmailConfig(page.id);
    if (!emailConfig.enabled) {
      logger.warn(`Email not configured for status page ${page.name} (${page.id})`);
      return { sent: 0, failed: 1 };
    }

    const displayName = page.organizationName || page.name;
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
                        <span style="font-weight: 600; color: ${theme.color};">Start:</span> {{start_time}}
                    </div>
                    {{end_time_section}}
                </div>
                {{posted_at_section}}
            </div>
            <div style="text-align: center; margin-top: 32px;">
                <a href="${escapeHtml(statusPageUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">View Status Page</a>
            </div>
        `;

    const body = EmailContent(contentBody);
    const footer = SubscriberEmailFooter('{{unsubscribe_url}}', safeDisplayName);
    const html = EmailContainer(announcementHeader + body + footer);

    const PAGE_SIZE = 500;
    const trafficClass = 'BULK' as const;
    const eventKey = announcementGenerationEventKey(notificationGeneration);
    const fanout = await beginNotificationFanout({
      statusPageId,
      sourceType: 'STATUS_PAGE_ANNOUNCEMENT',
      sourceId: announcement.id,
      eventKey,
      trafficClass,
      providerKey: emailConfig.provider || undefined,
      subject,
      html,
    });
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined = fanout.cursor ?? undefined;

    const rawAffected = announcement.affectedServiceIds;
    const affectedIds: string[] = Array.isArray(rawAffected)
      ? rawAffected.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    const hasScopedServices = affectedIds.length > 0;

    while (true) {
      if (!(await bulkQueueHasCapacity())) {
        throw new BulkQueueBackpressureError();
      }

      const [currentAnn, liveGeneration] = await Promise.all([
        prisma.statusPageAnnouncement.findFirst({
          where: { id: announcement.id, statusPageId },
          select: { isActive: true, publishAt: true, notificationTiming: true },
        }),
        readAnnouncementNotificationGeneration(announcement.id, statusPageId),
      ]);
      if (
        !currentAnn ||
        !currentAnn.isActive ||
        currentAnn.notificationTiming === 'NONE' ||
        (currentAnn.publishAt && currentAnn.publishAt.getTime() > Date.now()) ||
        liveGeneration !== notificationGeneration
      ) {
        logger.info('status_page.announcement_fanout_stale_generation', {
          announcementId: announcement.id,
          statusPageId,
          expectedGeneration: notificationGeneration,
          currentGeneration: liveGeneration,
        });
        await recordFanoutPage(fanout.id, {
          cursor,
          materialized: 0,
          failed: 0,
          complete: true,
        });
        return { sent, failed, skipped: true };
      }

      const subscriptions = await prisma.statusPageSubscription.findMany({
        where: hasScopedServices
          ? {
              statusPageId,
              state: 'ACTIVE',
              verified: true,
              unsubscribedAt: null,
              OR: [
                { selectedServices: { none: {} } },
                { selectedServices: { some: { serviceId: { in: affectedIds } } } },
              ],
            }
          : { statusPageId, state: 'ACTIVE', verified: true, unsubscribedAt: null },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, email: true, token: true, timezone: true, preferences: true },
      });
      if (subscriptions.length === 0) {
        await recordFanoutPage(fanout.id, {
          cursor,
          materialized: 0,
          failed: 0,
          complete: true,
        });
        break;
      }

      let eligibleSubscriptions = subscriptions;
      if (deliveryMode === 'UNDELIVERED_ONLY') {
        const historical = await prisma.notification.findMany({
          where: {
            sourceType: 'STATUS_PAGE_ANNOUNCEMENT',
            sourceId: announcement.id,
            recipientType: 'SUBSCRIBER',
            recipientId: { in: subscriptions.map(subscription => subscription.id) },
            OR: [
              { status: { in: ['SENT', 'DELIVERED'] } },
              {
                deliveryAttempts: {
                  some: { outcome: { in: ['ACCEPTED', 'AMBIGUOUS'] } },
                },
              },
            ],
          },
          select: { recipientId: true },
        });
        const alreadyReachedProvider = new Set(
          historical
            .map(item => item.recipientId)
            .filter((recipientId): recipientId is string => Boolean(recipientId))
        );
        eligibleSubscriptions = selectAnnouncementRecipientsNeedingReplacement(
          subscriptions,
          alreadyReachedProvider
        );
      }

      const unsubscribeTokens =
        eligibleSubscriptions.length > 0
          ? await issueUnsubscribeTokensBatch(
              eligibleSubscriptions.map(subscription => subscription.id)
            )
          : new Map<string, string>();
      let pageSent = 0;
      let pageFailed = 0;
      let pageError: unknown;

      const isAllDay = announcement.allDay || announcement.timeMode === 'ALL_DAY';

      if (eligibleSubscriptions.length > 0) {
        try {
          const result = await createCentralNotificationIntentsBatch(
            eligibleSubscriptions.map(sub => {
              const preferences =
                sub.preferences && typeof sub.preferences === 'object' && !Array.isArray(sub.preferences)
                  ? (sub.preferences as Record<string, unknown>)
                  : null;
              const rawTz = sub.timezone || preferences?.timezone;
              const subTz =
                typeof rawTz === 'string' && isValidTimeZone(rawTz.trim()) ? rawTz.trim() : 'UTC';

              let startTimeForSub: string;
              let endTimeSectionForSub = '';

              if (isAllDay) {
                startTimeForSub = `All day · ${new Date(announcement.startDate).toLocaleDateString(
                  'en-US',
                  {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }
                )}`;
              } else {
                startTimeForSub = formatDateTime(announcement.startDate, subTz, {
                  format: 'datetime',
                  includeTimeZone: true,
                });
                if (announcement.endDate) {
                  const endFormatted = formatDateTime(announcement.endDate, subTz, {
                    format: 'datetime',
                    includeTimeZone: true,
                  });
                  endTimeSectionForSub = `<div><span style="font-weight: 600; color: ${theme.color};">End:</span> ${endFormatted}</div>`;
                }
              }

              const postedAtFormatted = formatDateTime(announcement.createdAt || new Date(), subTz, {
                format: 'datetime',
                includeTimeZone: true,
              });
              const postedAtSectionForSub = `<p style="font-size: 14px; color: #9ca3af; margin-top: 16px; font-style: italic;">Posted on ${postedAtFormatted}</p>`;

              return {
                category: 'STATUS_PAGE',
                channel: 'EMAIL',
                recipientType: 'SUBSCRIBER',
                recipientId: sub.id,
                recipientAddress: sub.email,
                templateKey: 'status-page-announcement',
                sourceType: 'STATUS_PAGE_ANNOUNCEMENT',
                sourceId: announcement.id,
                eventKey: fanout.eventKey,
                displayMessage: subject,
                trafficClass,
                priority:
                  announcement.type === 'INCIDENT'
                    ? NOTIFICATION_PRIORITY.STATUS_INCIDENT_ANNOUNCEMENT
                    : NOTIFICATION_PRIORITY.STATUS_ANNOUNCEMENT,
                contentId: fanout.contentId,
                fanoutId: fanout.id,
                payload: {
                  kind: 'EMAIL',
                  providerKey: emailConfig.provider || undefined,
                  to: sub.email,
                  subject,
                  contentId: fanout.contentId,
                  unsubscribeUrl: `${statusPageUrl}/unsubscribe/${unsubscribeTokens.get(sub.id)}`,
                  startTime: startTimeForSub,
                  endTimeSection: endTimeSectionForSub,
                  postedAtSection: postedAtSectionForSub,
                  providerScope: { statusPageId: page.id, subscriptionId: sub.id },
                },
              };
            })
          );
          pageSent = result.created;
        } catch (error) {
          pageFailed = eligibleSubscriptions.length;
          pageError = error;
          logger.error('status_page.announcement_fanout_page_failed', {
            statusPageId: page.id,
            announcementId: announcement.id,
            notificationGeneration,
            deliveryMode,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      sent += pageSent;
      failed += pageFailed;
      if (pageFailed > 0) {
        throw new Error(
          `Failed to materialize ${pageFailed} notification intents; retrying page: ${pageError instanceof Error ? pageError.message : String(pageError)}`
        );
      }
      cursor = subscriptions.at(-1)?.id;
      if (cursor) {
        await recordFanoutPage(fanout.id, {
          cursor,
          materialized: pageSent,
          failed: pageFailed,
          complete: subscriptions.length < PAGE_SIZE,
        });
      }
      if (subscriptions.length < PAGE_SIZE || !cursor) break;
    }

    logger.info('status_page.announcement_fanout_enqueued', {
      statusPageId,
      announcementId,
      notificationGeneration,
      deliveryMode,
      sent,
      failed,
    });
    addOperationalMetric('opsknight_status_page_fanout_total', sent, {
      event: 'announcement',
      outcome: 'enqueued',
    });
    addOperationalMetric('opsknight_status_page_fanout_total', failed, {
      event: 'announcement',
      outcome: 'failed',
    });
    return { sent, failed };
  } catch (error) {
    if (error instanceof BulkQueueBackpressureError) {
      addOperationalMetric('opsknight_status_fanout_campaign_total', 1, { outcome: 'backpressured' });
      throw error;
    }
    logger.error('Failed to notify status page subscribers about announcement', {
      error: error instanceof Error ? error.message : 'Unknown error',
      announcementId,
      statusPageId,
      notificationGeneration,
      deliveryMode,
    });
    addOperationalMetric('opsknight_status_page_fanout_total', 1, {
      event: 'announcement',
      outcome: 'failed',
    });
    return { sent: 0, failed: 1 };
  }
}
