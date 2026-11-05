import type { IncidentStatus } from '@prisma/client';
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
import { renderEmail } from '@/emails/render';
import { StatusUpdateEmail } from '@/emails/templates/status-update';
import {
  StatusAnnouncementEmail,
  announcementEndTimeSection,
  announcementPostedAtSection,
  announcementPresentation,
} from '@/emails/templates/status-announcement';
import { normalizeSupportUrl, resolveBrandLogoUrl } from '@/emails/utils';
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
  deliveryKey?: string,
  expectedIncident?: { status?: IncidentStatus; escalationGeneration?: number }
): Promise<{ success: boolean; sent: number; failed: number; skipped?: boolean }> {
  let totalSent = 0;
  let totalFailed = 0;
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        visibility: true,
        escalationGeneration: true,
        serviceId: true,
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        service: { select: { name: true } },
      },
    });

    if (!incident) {
      logger.error(`Incident ${incidentId} not found for status page notifications`);
      return { success: true, sent: 0, failed: 0, skipped: true };
    }

    // Validate the outbox generation against the same fresh row used to plan
    // subscriber delivery. Never trust a serialized incident snapshot here.
    if (
      (expectedIncident?.status != null && incident.status !== expectedIncident.status) ||
      (expectedIncident?.escalationGeneration != null &&
        incident.escalationGeneration !== expectedIncident.escalationGeneration)
    ) {
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

      // Check if this service is currently in an active scheduled maintenance window on this status page
      const now = new Date();
      const activeMaintenances = await prisma.statusPageAnnouncement.findMany({
        where: {
          statusPageId: page.id,
          type: 'MAINTENANCE',
          isActive: true,
          publishAt: { lte: now },
          startDate: { lte: now },
          OR: [{ endDate: { gte: now } }, { endDate: null }],
        },
        select: { id: true, title: true, affectedServiceIds: true },
      });

      const matchingMaintenance = activeMaintenances.find(maintenance => {
        const affected = Array.isArray(maintenance.affectedServiceIds)
          ? (maintenance.affectedServiceIds as string[])
          : [];
        return affected.length === 0 || affected.includes(incident.serviceId);
      });

      if (matchingMaintenance) {
        logger.info('status_page.incident_notification_suppressed_maintenance', {
          incidentId,
          serviceId: incident.serviceId,
          statusPageId: page.id,
          announcementId: matchingMaintenance.id,
          maintenanceTitle: matchingMaintenance.title,
        });
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
      const presentation = buildSubscriberIncidentPresentation(page, incident);
      const subject = formatSubject(displayName, presentation.incident.title, eventType);
      const html = await formatEmailBody(
        displayName,
        presentation.incident,
        eventType,
        statusPageUrl,
        page.contactUrl,
        brandLogoUrl,
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
                listUnsubscribeUrl: oneClickUnsubscribeUrl(appBaseUrl, unsubscribeTokens.get(sub.id)),
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
      addOperationalMetric('opsknight_status_fanout_campaign_total', 1, {
        outcome: 'backpressured',
      });
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

/**
 * RFC 8058 one-click unsubscribe endpoint for the List-Unsubscribe header. Mail providers
 * POST here without cookies or an Origin, so it lives on the app host (public /api/status).
 */
function oneClickUnsubscribeUrl(appBaseUrl: string, token: string | undefined): string | undefined {
  if (!token || !/^https?:\/\//i.test(appBaseUrl)) return undefined;
  return `${appBaseUrl.replace(/\/+$/, '')}/api/status/subscriptions/unsubscribe/one-click/${encodeURIComponent(token)}`;
}

async function formatEmailBody(
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
): Promise<string> {
  const { html } = await renderEmail(
    StatusUpdateEmail({
      pageName,
      logoUrl,
      statusPageUrl,
      eventType,
      incidentTitle: incident.title || 'Incident Update',
      serviceName: privacy.showAffectedService ? incident.service?.name || 'Service' : undefined,
      description: privacy.showDescription ? incident.description || undefined : undefined,
      // Subscribers have no stored timezone here, so state UTC explicitly.
      postedAt: privacy.showTimestamp
        ? formatDateTime(new Date(), 'UTC', { format: 'datetime', includeTimeZone: true })
        : undefined,
      supportUrl: normalizeSupportUrl(contactUrl),
      // Substituted per recipient at send time (notification-control-plane).
      unsubscribeUrl: '{{unsubscribe_url}}',
    })
  );
  return html;
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
      logger.info(
        `Announcement ${announcementId} is inactive/withdrawn; skipping notification fan-out`
      );
      return { sent: 0, failed: 0, skipped: true };
    }

    if (announcement.publishAt && announcement.publishAt.getTime() > Date.now()) {
      logger.info(
        `Announcement ${announcementId} publishAt is in the future; skipping notification fan-out`
      );
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
    const theme = announcementPresentation(announcement.type as string);
    const subject = `[${displayName}] ${theme.label}: ${announcement.title}`;
    const { html } = await renderEmail(
      StatusAnnouncementEmail({
        pageName: displayName,
        logoUrl: brandLogoUrl,
        statusPageUrl,
        type: announcement.type as string,
        title: announcement.title || 'Announcement',
        message: announcement.message || '',
        // Per-recipient placeholders, substituted at send time in the subscriber's timezone.
        startTime: '{{start_time}}',
        endTimeSectionHtml: '{{end_time_section}}',
        postedAtSectionHtml: '{{posted_at_section}}',
        unsubscribeUrl: '{{unsubscribe_url}}',
      })
    );

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
                sub.preferences &&
                typeof sub.preferences === 'object' &&
                !Array.isArray(sub.preferences)
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
                  endTimeSectionForSub = announcementEndTimeSection(endFormatted);
                }
              }

              const postedAtFormatted = formatDateTime(
                announcement.createdAt || new Date(),
                subTz,
                {
                  format: 'datetime',
                  includeTimeZone: true,
                }
              );
              const postedAtSectionForSub = announcementPostedAtSection(postedAtFormatted);

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
                  listUnsubscribeUrl: oneClickUnsubscribeUrl(
                    appBaseUrl,
                    unsubscribeTokens.get(sub.id)
                  ),
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
      addOperationalMetric('opsknight_status_fanout_campaign_total', 1, {
        outcome: 'backpressured',
      });
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
