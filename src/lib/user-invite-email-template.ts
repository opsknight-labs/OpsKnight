/**
 * User Invite Email Template
 * Branded to match the OpsKnight auth experience.
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
import { getBaseUrl } from '@/lib/env-validation';

export interface UserInviteEmailData {
  userName: string;
  inviteUrl: string;
  invitedBy?: string;
  expiresInDays?: number;
}

export function getUserInviteEmailTemplate(data: UserInviteEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'You are invited to OpsKnight';
  const expiresText = data.expiresInDays ? `${data.expiresInDays} days` : '7 days';
  const greetingName = data.userName || 'there';
  const safeGreetingName = escapeHtml(greetingName);
  const safeInvitedBy = data.invitedBy ? escapeHtml(data.invitedBy) : '';
  const rawInviteUrl = data.inviteUrl?.trim() || '#';
  const resolveLogoUrl = (baseUrl: string) => {
    const parsed = new URL(baseUrl);
    const basePath =
      parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    const prefix = basePath ? `${parsed.origin}${basePath}` : parsed.origin;
    return `${prefix}/logo.png`;
  };
  let logoUrl: string | undefined;
  try {
    const baseUrl = getBaseUrl();
    logoUrl = resolveLogoUrl(baseUrl);
  } catch {
    logoUrl = undefined;
  }
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : undefined;

  const content = `
        ${EmailHeader('You are invited', 'Activate your OpsKnight account', {
          headerGradient: 'linear-gradient(135deg, #0b0b0f 0%, #111827 45%, #0f172a 100%)',
          logoUrl: safeLogoUrl,
        })}
        ${EmailContent(`
            <div style="text-align: center; margin-bottom: 28px;">
                <div style="display: inline-block; background: rgba(59, 130, 246, 0.12); border-radius: 999px; padding: 12px 22px; margin-bottom: 18px; border: 1px solid rgba(59, 130, 246, 0.35);">
                    <span style="font-size: 34px; filter: drop-shadow(0 2px 4px rgba(37, 99, 235, 0.25));">🚀</span>
                </div>
                <h2 style="margin: 0 0 10px 0; color: #111827; font-size: 24px; font-weight: 800; letter-spacing: -0.02em;">
                    Welcome, ${safeGreetingName}
                </h2>
                <p style="margin: 0; color: #6b7280; font-size: 15px; line-height: 1.6;">
                    You have been invited${safeInvitedBy ? ` by <strong>${safeInvitedBy}</strong>` : ''} to join OpsKnight.
                </p>
            </div>

            <div style="background: linear-gradient(135deg, #0b0b0f 0%, #111827 100%); border: 1px solid #1f2937; border-radius: 14px; padding: 24px 20px; margin: 24px 0; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);">
                <p style="margin: 0 0 20px 0; color: #e2e8f0 !important; font-size: 15px; line-height: 1.6; text-align: center;">
                    Set your password to activate your account and access the OpsKnight console.
                </p>
                ${EmailButton('Set up your account →', rawInviteUrl, {
                  buttonBackground: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  buttonShadow: '0 10px 24px rgba(37, 99, 235, 0.35)',
                })}
                <p style="margin: 20px 0 0 0; padding-top: 20px; border-top: 1px solid rgba(148, 163, 184, 0.2); color: #94a3b8 !important; font-size: 13px; text-align: center;">
                    ⏱️ This invite link expires in ${expiresText}
                </p>
            </div>

            <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; font-weight: 600;">
                    Button not working?
                </p>
                <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; word-break: break-all;">
                    Copy and paste this link: <a href="${escapeHtml(rawInviteUrl)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(rawInviteUrl)}</a>
                </p>
            </div>

            ${AlertBox(
              'Security note',
              'If you did not expect this invitation, you can safely ignore this email.',
              'info'
            )}
        `)}
        ${EmailFooter()}
    `;

  const html = EmailContainer(content);

  const text = `
OpsKnight - Invitation

Hello ${greetingName},

You have been invited${data.invitedBy ? ` by ${data.invitedBy}` : ''} to join OpsKnight.

Set your password to activate your account:
${data.inviteUrl}

This invite link expires in ${expiresText}.

If you did not expect this invitation, you can safely ignore this email.
    `.trim();

  return { subject, html, text };
}
