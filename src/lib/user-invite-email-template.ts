/**
 * User Invite Email Template
 * Branded to match the OpsKnight auth experience.
 * Rendered with the shared React Email primitives (src/emails).
 */

import { renderEmail } from '@/emails/render';
import { UserInviteEmail } from '@/emails/templates/user-invite';
import { getSsoInvitationEmailTemplate } from '@/lib/authentication-email-template';

export interface UserInviteEmailData {
  userName: string;
  inviteUrl: string;
  invitedBy?: string;
  expiresInDays?: number;
  ssoOnly?: boolean;
}

export async function getUserInviteEmailTemplate(data: UserInviteEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  if (data.ssoOnly) return getSsoInvitationEmailTemplate(data);
  const subject = "[OpsKnight] You're invited to join";
  const expiresText = data.expiresInDays ? `${data.expiresInDays} days` : '7 days';
  const greetingName = data.userName || 'there';
  const inviteUrl = data.inviteUrl?.trim() || '#';

  const text = `
[OpsKnight] Invitation

Hi ${greetingName},

You have been invited${data.invitedBy ? ` by ${data.invitedBy}` : ''} to join OpsKnight.

Set your password to access your account:
${data.inviteUrl}

This invite link expires in ${expiresText}.

If you did not expect this invitation, you can safely ignore this email.
    `.trim();

  const { html } = await renderEmail(
    UserInviteEmail({ greetingName, invitedBy: data.invitedBy, inviteUrl, expiresText }),
    { text }
  );
  return { subject, html, text };
}
