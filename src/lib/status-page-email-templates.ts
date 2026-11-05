/**
 * Status page subscriber verification email.
 * Incident and announcement subscriber emails are rendered in status-page-notifications.ts.
 */
import { renderEmail } from '@/emails/render';
import { StatusVerificationEmail } from '@/emails/templates/status-verification';
import { resolveBrandLogoUrl } from '@/emails/utils';

export interface EmailTemplateData {
  statusPageName: string;
  organizationName?: string;
  statusPageUrl: string;
  logoUrl?: string;
  unsubscribeUrl?: string;
}

/** Subject line format is relied on by subscription tests and must not change. */
export async function getVerificationEmailTemplate(
  data: EmailTemplateData & { verificationUrl: string }
): Promise<{ subject: string; html: string; text: string }> {
  const displayName = data.organizationName || data.statusPageName;
  const subject = `[${displayName}] 🔐 Verify your subscription`;
  const text = `
${displayName} - Verify Your Email Subscription

Thank you for subscribing to ${displayName} status updates!

To complete your subscription, please verify your email address by visiting:
${data.verificationUrl}

This verification link will expire in 7 days.

If you did not subscribe, you can safely ignore this email.
    `.trim();

  const { html } = await renderEmail(
    StatusVerificationEmail({
      pageName: displayName,
      logoUrl: resolveBrandLogoUrl(data.logoUrl, data.statusPageUrl),
      statusPageUrl: data.statusPageUrl,
      verificationUrl: data.verificationUrl,
      unsubscribeUrl: data.unsubscribeUrl,
    }),
    { text }
  );
  return { subject, html, text };
}
