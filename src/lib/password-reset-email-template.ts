/**
 * Password Reset Email Template using OpsKnight Branding
 */

import {
  EmailContainer,
  EmailHeader,
  EmailContent,
  EmailButton,
  AlertBox,
  EmailFooter,
  escapeHtml,
} from '@/lib/email-components';

export interface PasswordResetEmailData {
  userName: string;
  resetLink: string;
  expiryMinutes?: number;
}

/**
 * Password Reset Request Template
 * Professional, secure, and branded template for password reset emails
 */
export function getPasswordResetEmailTemplate(data: PasswordResetEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = '🔐 Reset your OpsKnight password';
  const expiryText = data.expiryMinutes ? `${data.expiryMinutes} minutes` : '1 hour';
  const safeUserName = escapeHtml(data.userName);
  const safeResetLink = escapeHtml(data.resetLink);

  const content = `
        ${EmailHeader('Password Reset Request', 'OpsKnight Account Security', {
          headerGradient: 'linear-gradient(135deg, #0b0b0f 0%, #111827 45%, #0f172a 100%)',
        })}
        ${EmailContent(`
            <!-- Security Icon -->
            <div style="text-align: center; margin-bottom: 32px;">
                <div style="display: inline-block; background: rgba(16, 185, 129, 0.12); border-radius: 999px; padding: 12px 22px; margin-bottom: 20px; border: 1px solid rgba(16, 185, 129, 0.35);">
                    <span style="font-size: 38px; filter: drop-shadow(0 2px 4px rgba(16, 185, 129, 0.25));">🔐</span>
                </div>
                <h2 style="margin: 0 0 12px 0; color: #111827; font-size: 26px; font-weight: 800; letter-spacing: -0.02em;">
                    Reset Your Password
                </h2>
                <p style="margin: 0; color: #6b7280; font-size: 15px; line-height: 1.6;">
                    Hello ${safeUserName}, we received a request to reset your password.
                </p>
            </div>
            
            <!-- Reset Instructions -->
            <div style="background: linear-gradient(135deg, #0b0b0f 0%, #111827 100%); border: 1px solid #1f2937; border-radius: 14px; padding: 24px 20px; margin: 24px 0; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);">
                <p style="margin: 0 0 20px 0; color: #e2e8f0; font-size: 15px; line-height: 1.6; text-align: center;">
                    Click the button below to create a new password for your account:
                </p>
                
                ${EmailButton('Reset Password →', safeResetLink, {
                  buttonBackground: 'linear-gradient(135deg, #10b981 0%, #22c55e 100%)',
                  buttonShadow: '0 10px 24px rgba(16, 185, 129, 0.35)',
                })}
                
                <p style="margin: 24px 0 0 0; padding-top: 24px; border-top: 1px solid rgba(148, 163, 184, 0.2); color: #94a3b8; font-size: 13px; text-align: center;">
                    ⏱️ This link expires in ${expiryText}
                </p>
            </div>
            
            <!-- Alternative Link -->
            <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; font-weight: 600;">
                    Button not working?
                </p>
                <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; word-break: break-all;">
                    Copy and paste this link: <a href="${safeResetLink}" style="color: #10b981; text-decoration: none;">${safeResetLink}</a>
                </p>
            </div>
            
            <!-- Security Warning -->
            ${AlertBox(
              '🛡️ Security Notice',
              'If you did not request a password reset, please ignore this email. Your password will remain unchanged. Consider enabling two-factor authentication for added security.',
              'warning'
            )}
            
            <!-- Additional Info -->
            <div style="text-align: center; margin-top: 32px; padding-top: 32px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 600;">
                    Need help with your account?
                </p>
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                    Contact your administrator or visit our support center.
                </p>
            </div>
        `)}
        ${EmailFooter()}
    `;

  const html = EmailContainer(content);

  const text = `
OpsKnight - Password Reset Request

Hello ${data.userName},

We received a request to reset your password for your OpsKnight account.

To reset your password, visit this link:
${data.resetLink}

This link will expire in ${expiryText}.

SECURITY NOTICE:
If you did not request a password reset, please ignore this email. Your password will remain unchanged.

Need help? Contact your administrator for assistance.

---
This is an automated message from OpsKnight Incident Management.
    `.trim();

  return { subject, html, text };
}
