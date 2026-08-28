import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email';
import { getVerificationEmailTemplate } from '@/lib/status-page-email-templates';
import { getBaseUrl } from '@/lib/env-validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
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
export async function POST(req: NextRequest) {
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
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const statusPageId = typeof payload.statusPageId === 'string' ? payload.statusPageId : '';
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';

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

    const token = randomBytes(32).toString('hex');
    const verificationToken = randomBytes(32).toString('hex');

    const existing = await prisma.statusPageSubscription.findUnique({
      where: {
        statusPageId_email: { statusPageId, email: normalizedEmail },
      },
    });

    if (existing) {
      if (existing.unsubscribedAt) {
        await prisma.statusPageSubscription.update({
          where: { id: existing.id },
          data: {
            unsubscribedAt: null,
            token,
            verificationToken,
            verified: false,
          },
        });
      } else if (existing.verified) {
        return jsonOk({ success: true, message: 'Already subscribed' }, 200);
      } else if (Date.now() - existing.subscribedAt.getTime() < 60_000) {
        return jsonOk(
          {
            success: true,
            message: 'Verification email was recently sent. Please try again shortly.',
          },
          200
        );
      } else {
        await prisma.statusPageSubscription.update({
          where: { id: existing.id },
          data: { token, verificationToken },
        });
      }
    } else {
      await prisma.statusPageSubscription.create({
        data: {
          statusPageId,
          email: normalizedEmail,
          token,
          verificationToken,
          verified: false,
        },
      });
    }

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

        await sendEmail(
          {
            to: normalizedEmail,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text,
          },
          emailConfig
        );

        logger.info('api.status_page.subscription.verification_email_sent', {
          statusPageId,
          email: normalizedEmail,
          provider: emailConfig.provider,
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

    return jsonOk(
      { success: true, message: 'Subscription created. Please check your email to verify.' },
      200
    );
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('api.status_page.subscription.error', { error });
    return jsonError('Failed to create subscription', 500);
  }
}
