/**
 * Password Reset Email Template using OpsKnight Branding.
 * Rendered with the shared React Email primitives (src/emails).
 */
import { renderEmail } from '@/emails/render';
import { PasswordResetEmail } from '@/emails/templates/password-reset';

export interface PasswordResetEmailData {
  userName: string;
  resetLink: string;
  expiryMinutes?: number;
}

/**
 * Password Reset Request Template
 * Professional, secure, and branded template for password reset emails.
 */
export async function getPasswordResetEmailTemplate(data: PasswordResetEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = '[OpsKnight] Reset your password';
  const expiryText = data.expiryMinutes ? `${data.expiryMinutes} minutes` : '1 hour';

  const text = `
[OpsKnight] Password Reset Request

Hi ${data.userName},

We received a request to reset your password for your OpsKnight account.

To reset your password, visit this link:
${data.resetLink}

This link will expire in ${expiryText}.

SECURITY NOTICE:
If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from OpsKnight.
    `.trim();

  const { html } = await renderEmail(
    PasswordResetEmail({ userName: data.userName, resetLink: data.resetLink, expiryText }),
    { text }
  );
  return { subject, html, text };
}
