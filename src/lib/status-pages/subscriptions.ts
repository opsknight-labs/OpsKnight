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
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { hashSubscriptionToken } from './subscription-tokens';
import { subscriptionRequestAction } from './subscription-policy';
import {
  getStatusPageLogoUrl,
  getStatusPagePublicUrl,
  getStatusPageVerificationUrl,
} from '@/lib/status-page-url';

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
        preferences: z
          .object({
            selectedServiceIds: z.array(z.string().min(1).max(200)).max(100).optional(),
          })
          .optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return jsonError('A valid status page and email address are required.', 400);
    const { statusPageId, email, preferences: rawPreferences } = parsed.data;

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
    if (!statusPage.showSubscribe) return jsonError('Subscriptions are disabled.', 404);
    if (statusPage.requireAuth && !(await getServerSession(await getAuthOptions()))) {
      return jsonError('Authentication required', 401);
    }

    // Industry-standard service picker: optional preferences.selectedServiceIds, validated against page's services
    const preferencesProvided = rawPreferences !== undefined;
    let normalizedPreferences: { selectedServiceIds?: string[] } | null = null;
    let normalizedServiceIds: string[] | null = null;
    if (preferencesProvided) {
      if (rawPreferences?.selectedServiceIds !== undefined) {
        // Explicit Selected mode — empty or all-invalid must not widen to "all".
        if (rawPreferences.selectedServiceIds.length === 0) {
          return jsonError(
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
          );
        }
        const allowed = await prisma.statusPageService.findMany({
          where: { statusPageId, showOnPage: true },
          select: { serviceId: true },
        });
        const allowedSet = new Set(allowed.map(r => r.serviceId));
        const filtered = rawPreferences.selectedServiceIds.filter(id => allowedSet.has(id));
        if (filtered.length === 0) {
          return jsonError(
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
          );
        }
        const unique = [...new Set(filtered)];
        normalizedPreferences = { selectedServiceIds: unique };
        normalizedServiceIds = unique;
      } else {
        // preferences: {} with no selectedServiceIds — treat as "all" (null) but still considered provided
        normalizedPreferences = null;
        normalizedServiceIds = null;
      }
    }

    async function syncSubscriptionServices(subscriptionId: string) {
      if (!preferencesProvided) return;
      if (normalizedServiceIds === null) {
        await prisma.statusPageSubscriptionService.deleteMany({ where: { subscriptionId } });
      } else {
        await prisma.$transaction(async tx => {
          await tx.statusPageSubscriptionService.deleteMany({ where: { subscriptionId } });
          if (normalizedServiceIds!.length > 0) {
            await tx.statusPageSubscriptionService.createMany({
              data: normalizedServiceIds!.map(serviceId => ({ subscriptionId, serviceId })),
              skipDuplicates: true,
            });
          }
        });
      }
    }

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
          const pendingValue =
            normalizedPreferences !== null ? normalizedPreferences : null;
          const alreadyPending =
            existingPrefs !== null &&
            (existingPrefs as Record<string, unknown>)._pendingPreferences !== undefined;
          // Avoid redundant writes when pending already matches
          const pendingJson = JSON.stringify(pendingValue);
          const currentPendingJson = alreadyPending
            ? JSON.stringify((existingPrefs as Record<string, unknown>)._pendingPreferences)
            : '__none__';
          if (pendingJson !== currentPendingJson) {
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
          } else {
            await prisma.statusPageSubscription.update({
              where: { id: existing.id },
              data: {
                verificationToken: pendingVerif,
                verificationTokenExpiresAt: verificationExpiresAt,
              },
            });
          }
          // Do NOT sync join table — stays as-is until verification confirms.
          isActivePendingChange = true;
        } else {
          // No preference change for ACTIVE, or suppressed/bounced/complained — generic, no email
          return subscriptionAccepted();
        }
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
            ...(preferencesProvided
              ? { preferences: normalizedPreferences as unknown as Prisma.InputJsonValue }
              : {}),
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
            ...(preferencesProvided
              ? { preferences: normalizedPreferences as unknown as Prisma.InputJsonValue }
              : {}),
          },
        });
        if (refreshed.count === 0) return subscriptionAccepted();
        if (preferencesProvided) await syncSubscriptionServices(existing.id);
      }
    } else {
      const created = await prisma.statusPageSubscription.create({
        data: {
          statusPageId,
          email: normalizedEmail,
          token: hashSubscriptionToken(token),
          verificationToken: hashSubscriptionToken(verificationToken),
          verificationTokenExpiresAt: verificationExpiresAt,
          verified: false,
          state: 'PENDING',
          ...(preferencesProvided
            ? { preferences: normalizedPreferences as unknown as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true },
      });
      if (preferencesProvided) await syncSubscriptionServices(created.id);
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

        const emailTemplate = getVerificationEmailTemplate({
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
