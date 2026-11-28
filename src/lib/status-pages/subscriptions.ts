import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { getVerificationEmailTemplate } from '@/lib/status-page-email-templates';
import { getBaseUrl } from '@/lib/env-validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { z } from 'zod/v3';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { isValidTimeZone } from '@/lib/timezone';
import { hashSubscriptionToken } from './subscription-tokens';
import { sameSubscriptionPicks, subscriptionRequestAction } from './subscription-policy';
import { pageSubscriberChannels } from './subscriber-channel-policy';
import {
  getStatusPageLogoUrl,
  getStatusPagePublicUrl,
  getStatusPageVerificationUrl,
} from '@/lib/status-page-url';
import { getAppUrl } from '@/lib/app-config';
import {
  extractStatusSessionToken,
  hasStatusPageAccess,
  isRequestToAppHost,
} from '@/lib/status-pages/status-auth';

/** Verification mails per address per page, and per page overall. Windows are fixed, so they advance. */
const VERIFICATION_MAILS_PER_ADDRESS = 5;
const VERIFICATION_MAILS_PER_ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_MAILS_PER_PAGE = 1000;
const VERIFICATION_MAILS_PER_PAGE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whether one more verification mail may go to this address. A refused request is answered like an
 * accepted one and changes nothing, so it neither mails nor invalidates the link already sent.
 */
async function verificationMailAllowed(statusPageId: string, email: string) {
  const address = await checkRateLimit(
    `api:status-page:verification-mail:address:${statusPageId}:${email}`,
    VERIFICATION_MAILS_PER_ADDRESS,
    VERIFICATION_MAILS_PER_ADDRESS_WINDOW_MS
  );
  if (!address.allowed) return false;
  const page = await checkRateLimit(
    `api:status-page:verification-mail:page:${statusPageId}`,
    VERIFICATION_MAILS_PER_PAGE,
    VERIFICATION_MAILS_PER_PAGE_WINDOW_MS
  );
  return page.allowed;
}

function rateLimitError(retryAfter: number) {
  return jsonError(new AppError({ code: 'RATE_LIMIT_EXCEEDED' }), undefined, { retryAfter });
}

/**
 * Subscribe to Status Page Updates
 * POST /api/status-page/subscribe
 */
export async function subscribeStatusPageRequest(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const ipRate = await checkRateLimit(`api:status-page:subscribe:ip:${ip}`, 10, 60_000);
    if (!ipRate.allowed) {
      return rateLimitError(Math.max(1, Math.ceil((ipRate.resetAt - Date.now()) / 1000)));
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const parsed = z
      .object({
        statusPageId: z.string().min(1).max(200),
        email: z.string().trim().email().max(254),
        timezone: z.string().max(100).optional(),
        preferences: z
          .object({
            selectedServiceIds: z.array(z.string().min(1).max(200)).max(100).optional(),
            selectedBusinessServiceIds: z.array(z.string().min(1).max(200)).max(50).optional(),
            timezone: z.string().max(100).optional(),
          })
          .optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return jsonError('A valid status page and email address are required.', 400);
    const {
      statusPageId,
      email,
      timezone: directTimezone,
      preferences: rawPreferences,
    } = parsed.data;
    const rawTz = directTimezone || rawPreferences?.timezone;
    const subscriberTimezone =
      typeof rawTz === 'string' && isValidTimeZone(rawTz.trim()) ? rawTz.trim() : 'UTC';

    if (!statusPageId || !email || !email.includes('@')) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Valid statusPageId and email are required',
          fields: [
            ...(!statusPageId
              ? [{ field: 'statusPageId', code: 'required', message: 'statusPageId is required' }]
              : []),
            ...(!email || !email.includes('@')
              ? [{ field: 'email', code: 'invalid', message: 'A valid email is required' }]
              : []),
          ],
        })
      );
    }

    const normalizedEmail = email.toLowerCase();
    const emailKey = `${statusPageId}:${normalizedEmail}`;
    const emailRate = await checkRateLimit(
      `api:status-page:subscribe:email:${emailKey}`,
      3,
      60_000
    );
    if (!emailRate.allowed) {
      return rateLimitError(Math.max(1, Math.ceil((emailRate.resetAt - Date.now()) / 1000)));
    }

    const statusPage = await prisma.statusPage.findFirst({
      where: { id: statusPageId, enabled: true },
    });

    if (!statusPage) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'Status page not found or disabled',
        })
      );
    }
    if (!statusPage.showSubscribe || !pageSubscriberChannels(statusPage).includes('EMAIL'))
      return jsonError('Subscriptions are disabled.', 404);
    if (statusPage.requireAuth) {
      const cookieHeader = req.headers.get('cookie');
      const statusToken = extractStatusSessionToken(cookieHeader);
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
      const appUrl = await getAppUrl();
      const isAppHost = isRequestToAppHost(host, appUrl);

      let isAuthorized = false;
      if (statusToken) {
        isAuthorized = await hasStatusPageAccess({
          pageId: statusPage.id,
          statusSessionCookie: statusToken,
          isAppHost,
        });
      }
      if (!isAuthorized && isAppHost) {
        const session = await getServerSession(await getAuthOptions());
        isAuthorized = !!session;
      }
      if (!isAuthorized) {
        return jsonError('Authentication required', 401);
      }
    }

    const selection = await resolveSubscriptionSelection(statusPage, rawPreferences);
    if ('error' in selection) return selection.error;
    const {
      provided: preferencesProvided,
      preferences: normalizedPreferences,
      serviceIds: normalizedServiceIds,
    } = selection;
    const syncSubscriptionServices = (subscriptionId: string) =>
      syncSubscriptionSelection(subscriptionId, selection);

    const token = randomBytes(32).toString('hex');
    const verificationToken = randomBytes(32).toString('hex');
    const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — must match email template
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    const existing = await prisma.statusPageSubscription.findUnique({
      where: {
        statusPageId_email: { statusPageId, email: normalizedEmail },
      },
    });

    let isActivePendingChange = false;
    if (existing) {
      const action = subscriptionRequestAction(existing.state, existing.subscribedAt, Date.now());
      // Deliverability state is authoritative. Provider suppressions can arrive
      // after an unsubscribe, so unsubscribedAt alone must never reactivate a
      // complained, bounced, or suppressed address.
      if (action === 'ACCEPT') {
        // ACTIVE: do not mutate preferences from unauthenticated request.
        // If preferences were supplied, send a re-verification email that keeps
        // the current preferences live until the subscriber confirms.
        if (existing.state === 'ACTIVE' && preferencesProvided) {
          // Persist pending preferences alongside the verification token so
          // the verify handler can atomically install them on confirmation.
          // Keep state=ACTIVE and current preferences untouched until verified.
          const pendingVerif = hashSubscriptionToken(verificationToken);
          const existingPrefs = (existing.preferences as Record<string, unknown> | null) ?? null;
          const pendingValue = normalizedPreferences !== null ? normalizedPreferences : null;
          const alreadyPending =
            existingPrefs !== null &&
            (existingPrefs as Record<string, unknown>)._pendingPreferences !== undefined;
          const pendingJson = JSON.stringify(pendingValue);
          const currentPendingJson = alreadyPending
            ? JSON.stringify((existingPrefs as Record<string, unknown>)._pendingPreferences)
            : '__none__';
          // Nothing to confirm: the picks are what the subscriber already has, or the same change is
          // already waiting for their confirmation. Do not mail or replace the link they hold.
          if (
            alreadyPending
              ? pendingJson === currentPendingJson
              : sameSubscriptionPicks(existingPrefs, normalizedPreferences)
          ) {
            return subscriptionAccepted();
          }
          if (!(await verificationMailAllowed(statusPageId, normalizedEmail))) {
            return subscriptionAccepted();
          }
          await prisma.statusPageSubscription.update({
            where: { id: existing.id },
            data: {
              verificationToken: pendingVerif,
              verificationTokenExpiresAt: verificationExpiresAt,
              preferences: {
                ...(existingPrefs ?? {}),
                _pendingPreferences: pendingValue,
                _pendingServiceIds: normalizedServiceIds,
              } as unknown as Prisma.InputJsonValue,
            },
          });
          // Do NOT sync join table — stays as-is until verification confirms.
          isActivePendingChange = true;
        } else {
          // No preference change for ACTIVE, or suppressed/bounced/complained — generic, no email
          return subscriptionAccepted();
        }
      }

      if (
        !isActivePendingChange &&
        action !== 'ACCEPT' &&
        !(await verificationMailAllowed(statusPageId, normalizedEmail))
      ) {
        return subscriptionAccepted();
      }

      if (!isActivePendingChange && action === 'REACTIVATE') {
        const reactivated = await prisma.statusPageSubscription.updateMany({
          where: { id: existing.id, state: 'UNSUBSCRIBED' },
          data: {
            unsubscribedAt: null,
            state: 'PENDING',
            suppressionReason: null,
            token: hashSubscriptionToken(token),
            verificationToken: hashSubscriptionToken(verificationToken),
            verificationTokenExpiresAt: verificationExpiresAt,
            verified: false,
            timezone: subscriberTimezone,
            ...(preferencesProvided ? { preferences: normalizedPreferences ?? Prisma.DbNull } : {}),
          },
        });

        // A provider callback may have applied a stronger suppression after the
        // initial read. Preserve that state and avoid queueing verification.
        if (reactivated.count === 0) return subscriptionAccepted();
        if (preferencesProvided) await syncSubscriptionServices(existing.id);
      } else if (!isActivePendingChange) {
        const refreshed = await prisma.statusPageSubscription.updateMany({
          where: { id: existing.id, state: 'PENDING' },
          data: {
            token: hashSubscriptionToken(token),
            verificationToken: hashSubscriptionToken(verificationToken),
            verificationTokenExpiresAt: verificationExpiresAt,
            timezone: subscriberTimezone,
            ...(preferencesProvided ? { preferences: normalizedPreferences ?? Prisma.DbNull } : {}),
          },
        });
        if (refreshed.count === 0) return subscriptionAccepted();
        if (preferencesProvided) await syncSubscriptionServices(existing.id);
      }
    } else {
      let created: { id: string };
      try {
        created = await prisma.statusPageSubscription.create({
          data: {
            statusPageId,
            email: normalizedEmail,
            token: hashSubscriptionToken(token),
            verificationToken: hashSubscriptionToken(verificationToken),
            verificationTokenExpiresAt: verificationExpiresAt,
            verified: false,
            state: 'PENDING',
            timezone: subscriberTimezone,
            ...(preferencesProvided ? { preferences: normalizedPreferences ?? Prisma.DbNull } : {}),
          },
          select: { id: true },
        });
      } catch (error) {
        // A concurrent first subscribe for this address won the race and sends the verification
        // email; answer exactly as the non-racing path does so the form cannot reveal the race.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return subscriptionAccepted();
        }
        throw error;
      }
      if (preferencesProvided) await syncSubscriptionServices(created.id);
      // The row exists; past the mail limits the address simply does not get a mail now.
      if (!(await verificationMailAllowed(statusPageId, normalizedEmail))) {
        return subscriptionAccepted();
      }
    }

    const subscription = existing
      ? { id: existing.id }
      : await prisma.statusPageSubscription.findUniqueOrThrow({
          where: { statusPageId_email: { statusPageId, email: normalizedEmail } },
          select: { id: true },
        });

    try {
      const { getStatusPageEmailConfig } = await import('@/lib/notification-providers');
      const emailConfig = await getStatusPageEmailConfig(statusPageId);

      if (!emailConfig.enabled || !emailConfig.provider) {
        logger.warn('api.status_page.subscription.no_email_provider', { statusPageId });
      } else {
        const appBaseUrl = getBaseUrl();
        const statusPageUrl = getStatusPagePublicUrl(statusPage, appBaseUrl);
        const verificationUrl = getStatusPageVerificationUrl(
          statusPage,
          verificationToken,
          appBaseUrl
        );

        const branding =
          statusPage.branding &&
          typeof statusPage.branding === 'object' &&
          !Array.isArray(statusPage.branding)
            ? (statusPage.branding as Record<string, unknown>)
            : {};
        const rawLogoUrl = typeof branding.logoUrl === 'string' ? branding.logoUrl : undefined;
        const logoUrl =
          rawLogoUrl && rawLogoUrl.startsWith('data:image/')
            ? getStatusPageLogoUrl(statusPage, statusPage.id, appBaseUrl)
            : rawLogoUrl;

        const emailTemplate = await getVerificationEmailTemplate({
          statusPageName: statusPage.name,
          organizationName: statusPage.organizationName || undefined,
          statusPageUrl,
          verificationUrl,
          logoUrl,
        });

        const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
        const delivery = await enqueueCentralNotification({
          category: 'STATUS_PAGE',
          channel: 'EMAIL',
          recipientType: 'SUBSCRIBER',
          recipientId: subscription.id,
          recipientAddress: normalizedEmail,
          templateKey: 'status-page-verification',
          sourceType: 'STATUS_PAGE_SUBSCRIPTION',
          sourceId: subscription.id,
          eventKey: hashSubscriptionToken(verificationToken),
          displayMessage: `Verify subscription to ${statusPage.name}`,
          priority: 2,
          payload: {
            kind: 'EMAIL',
            to: normalizedEmail,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text,
            providerScope: { statusPageId },
          },
        });

        logger.info('api.status_page.subscription.verification_email_enqueued', {
          statusPageId,
          email: normalizedEmail,
          provider: emailConfig.provider,
          notificationId: delivery.id,
          delivered: delivery.delivered === true,
        });
      }
    } catch (emailError) {
      // Subscription creation remains successful when delivery fails. The email
      // can be retried later; do not roll back the subscription contract.
      logger.error('api.status_page.subscription.verification_email_failed', {
        statusPageId,
        email: normalizedEmail,
        error: emailError instanceof Error ? emailError.message : String(emailError),
      });
    }

    logger.info('api.status_page.subscription.created', {
      statusPageId,
      email: normalizedEmail,
    });

    return subscriptionAccepted();
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('api.status_page.subscription.error', { error });
    return jsonError('Failed to create subscription', 500);
  }
}

function subscriptionAccepted() {
  return jsonOk(
    {
      success: true,
      message: 'If this email can receive status updates, we have sent the next step.',
    },
    200
  );
}

export type SubscriptionPreferencesInput = {
  selectedServiceIds?: string[];
  selectedBusinessServiceIds?: string[];
  timezone?: string;
};

export type SubscriptionSelection = {
  /** False: the request said nothing about services, so stored picks stay as they are. */
  provided: boolean;
  preferences: { selectedServiceIds?: string[]; selectedBusinessServiceIds?: string[] } | null;
  /** Null = every service on the page. */
  serviceIds: string[] | null;
  businessServiceIds: string[];
};

/**
 * Validates a subscriber's service / business-service picks against what the page offers. An
 * explicit selection that is empty or entirely invalid is rejected rather than widened to "all".
 * Shared by every subscriber channel (email, SMS, Slack, Teams).
 */
export async function resolveSubscriptionSelection(
  statusPage: { id: string; serviceLayout?: string | null },
  rawPreferences: SubscriptionPreferencesInput | undefined
): Promise<SubscriptionSelection | { error: Response }> {
  const statusPageId = statusPage.id;
  const provided = rawPreferences !== undefined;
  if (!provided) return { provided, preferences: null, serviceIds: null, businessServiceIds: [] };
  const pickedServices = rawPreferences?.selectedServiceIds;
  const pickedBusiness = rawPreferences?.selectedBusinessServiceIds;
  // preferences: {} with no selection means "all", but still counts as provided.
  if (pickedServices === undefined && pickedBusiness === undefined)
    return { provided, preferences: null, serviceIds: null, businessServiceIds: [] };
  if ((pickedServices?.length ?? 0) + (pickedBusiness?.length ?? 0) === 0) {
    return {
      error: jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'Select at least one service to follow, or leave service selection empty for all updates.',
          fields: [
            {
              field: 'preferences.selectedServiceIds',
              code: 'empty',
              message: 'Empty selection is not valid when service selection is provided.',
            },
          ],
        })
      ),
    };
  }
  const [allowed, allowedBusiness] = await Promise.all([
    pickedServices?.length
      ? prisma.statusPageService.findMany({
          where: { statusPageId, showOnPage: true },
          select: { serviceId: true },
        })
      : [],
    // Business services are offered only while the page groups by them.
    pickedBusiness?.length && statusPage.serviceLayout !== 'FLAT'
      ? prisma.statusPageBusinessService.findMany({
          where: { statusPageId, showOnPage: true },
          select: { businessServiceId: true },
        })
      : [],
  ]);
  const allowedSet = new Set(allowed.map(r => r.serviceId));
  const allowedBusinessSet = new Set(allowedBusiness.map(r => r.businessServiceId));
  const filtered = [...new Set((pickedServices ?? []).filter(id => allowedSet.has(id)))];
  const filteredBusiness = [
    ...new Set((pickedBusiness ?? []).filter(id => allowedBusinessSet.has(id))),
  ];
  if (filtered.length + filteredBusiness.length === 0) {
    return {
      error: jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'None of the selected services are available on this status page.',
          fields: [
            {
              field: 'preferences.selectedServiceIds',
              code: 'invalid',
              message: 'No valid service selected.',
            },
          ],
        })
      ),
    };
  }
  return {
    provided,
    preferences: {
      selectedServiceIds: filtered,
      ...(filteredBusiness.length ? { selectedBusinessServiceIds: filteredBusiness } : {}),
    },
    serviceIds: filtered,
    businessServiceIds: filteredBusiness,
  };
}

/** Replaces a subscription's service picks with `selection` (no-op when none was provided). */
export async function syncSubscriptionSelection(
  subscriptionId: string,
  selection: SubscriptionSelection
) {
  if (!selection.provided) return;
  await prisma.$transaction(async tx => {
    await tx.statusPageSubscriptionService.deleteMany({ where: { subscriptionId } });
    await tx.statusPageSubscriptionBusinessService.deleteMany({ where: { subscriptionId } });
    if (selection.serviceIds?.length) {
      await tx.statusPageSubscriptionService.createMany({
        data: selection.serviceIds.map(serviceId => ({ subscriptionId, serviceId })),
        skipDuplicates: true,
      });
    }
    if (selection.businessServiceIds.length) {
      await tx.statusPageSubscriptionBusinessService.createMany({
        data: selection.businessServiceIds.map(businessServiceId => ({
          subscriptionId,
          businessServiceId,
        })),
        skipDuplicates: true,
      });
    }
  });
}
