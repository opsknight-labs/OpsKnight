'use server';

import prisma from '@/lib/prisma';
import { revokeUserSessions } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { generateApiKey } from '@/lib/api-keys';
import { validatePasswordStrength } from '@/lib/passwords';
import {
  getEmailConfig,
  getSMSConfig,
  getVoiceConfig,
  getPushConfig,
  getWhatsAppConfig,
} from '@/lib/notification-providers';
import { logger } from '@/lib/logger';
import { getDefaultAvatar } from '@/lib/avatar';
import { logAudit } from '@/lib/audit';
import { isValidTimeZone } from '@/lib/timezone';
import {
  API_SCOPES,
  CAPABILITIES,
  hasCapability,
  isApiScope,
  isWriteApiScope,
} from '@/lib/authorization';
import { getCurrentUser } from '@/lib/rbac';

type ActionState = {
  error?: string | null;
  success?: boolean;
  token?: string | null;
};

export async function updateProfile(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const avatarFile = formData.get('avatar') as File | null;
    const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

    let avatarUpload: { data: Buffer; mimeType: string; url: string } | null = null;
    if (avatarFile && avatarFile.size > 0) {
      if (!ALLOWED_MIME_TYPES.has(avatarFile.type)) {
        return { error: 'Invalid file type. Please upload a PNG, JPEG, WebP, or GIF image.' };
      }
      if (avatarFile.size > 2 * 1024 * 1024) {
        return { error: 'File size too large. Max 2MB.' };
      }

      try {
        const bytes = await avatarFile.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const isPng =
          buffer.length >= 4 &&
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47;
        const isJpeg =
          buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        const isGif =
          buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
        const isWebp =
          buffer.length >= 12 &&
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP';

        if (!isPng && !isJpeg && !isGif && !isWebp) {
          return { error: 'Invalid image file signature. Please upload a valid image.' };
        }

        avatarUpload = {
          data: buffer,
          mimeType: avatarFile.type,
          url: `/api/users/${user.id}/avatar?t=${Date.now()}`,
        };
      } catch (err) {
        logger.error('Failed to read avatar upload', { error: err });
        return { error: 'Failed to upload profile photo.' };
      }
    }

    const removeAvatar =
      formData.get('removeAvatar') === 'true' || formData.get('resetAvatar') === 'true';

    const data: Partial<{
      name: string;
      department: string | null;
      jobTitle: string | null;
      avatarUrl: string | null;
    }> = {};

    if (formData.has('name')) {
      const n = (formData.get('name') as string | null)?.trim();
      if (!n || n.length < 2 || n.length > 120) {
        return { error: 'Name must be between 2 and 120 characters.' };
      }
      data.name = n;
    }

    if (formData.has('department')) {
      data.department = (formData.get('department') as string | null)?.trim() || null;
    }
    if (formData.has('jobTitle')) {
      data.jobTitle = (formData.get('jobTitle') as string | null)?.trim() || null;
    }

    const directAvatarUrl = (formData.get('avatarUrl') as string | null)?.trim();
    const isValidDirectUrl = (url: string) => {
      if (url.startsWith('/api/avatar') || url.startsWith('/avatars/')) return true;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && parsed.hostname === 'api.dicebear.com';
      } catch {
        return false;
      }
    };

    const currentName = data.name || user.name || 'User';
    if (removeAvatar) {
      data.avatarUrl = getDefaultAvatar(currentName, user.id);
    } else if (directAvatarUrl && isValidDirectUrl(directAvatarUrl)) {
      data.avatarUrl = directAvatarUrl;
    } else if (directAvatarUrl) {
      return { error: 'Invalid avatar URL.' };
    } else if (avatarUpload) {
      data.avatarUrl = avatarUpload.url;
    }

    if (Object.keys(data).length === 0 && !avatarUpload && !removeAvatar) {
      return { success: true };
    }

    await prisma.$transaction(async tx => {
      if (removeAvatar) {
        await tx.userAvatar.deleteMany({ where: { userId: user.id } });
      } else if (avatarUpload) {
        await tx.userAvatar.upsert({
          where: { userId: user.id },
          update: {
            data: avatarUpload.data,
            mimeType: avatarUpload.mimeType,
          },
          create: {
            userId: user.id,
            data: avatarUpload.data,
            mimeType: avatarUpload.mimeType,
          },
        });
      }

      if (Object.keys(data).length > 0) {
        await tx.user.update({
          where: { id: user.id },
          data,
        });
      }

      await logAudit(
        {
          action: 'user.profile.updated',
          entityType: 'USER',
          entityId: user.id,
          actorId: user.id,
          oldValue: {
            name: user.name,
            department: user.department,
            jobTitle: user.jobTitle,
            avatarUrl: user.avatarUrl,
          },
          newValue: {
            name: data.name ?? user.name,
            department: data.department ?? user.department,
            jobTitle: data.jobTitle ?? user.jobTitle,
            avatarChanged: Boolean(removeAvatar || avatarUpload || directAvatarUrl),
          },
        },
        tx
      );
    });

    revalidatePath('/settings/profile');
    revalidatePath('/settings');
    revalidatePath('/');
    revalidatePath('/incidents');
    revalidatePath('/users');
    revalidatePath('/policies');
    revalidatePath('/schedules');
    revalidatePath('/', 'layout');

    return { success: true };
  } catch (error) {
    logger.error('Error updating profile', { component: 'settings-actions', error });
    return { error: 'Unable to update profile. Please try again.' };
  }
}

export async function updatePreferences(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const timeZone = (formData.get('timeZone') as string | null)?.trim() || '';

    if (!timeZone || !isValidTimeZone(timeZone)) {
      return { error: 'Please select a valid IANA timezone.' };
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: user.id },
        data: { timeZone },
      });
      await logAudit(
        {
          action: 'user.preferences.updated',
          entityType: 'USER',
          entityId: user.id,
          actorId: user.id,
          oldValue: { timeZone: user.timeZone },
          newValue: { timeZone },
        },
        tx
      );
    });

    revalidatePath('/settings/profile');
    return { success: true };
  } catch (error) {
    logger.error('Error updating user preferences', { component: 'settings-actions', error });
    return { error: 'Unable to update preferences. Please try again.' };
  }
}

export async function updateNotificationPreferences(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();

    const emailEnabled =
      formData.get('emailNotificationsEnabled') === 'on' ||
      formData.get('emailNotificationsEnabled') === 'true';
    const smsEnabled =
      formData.get('smsNotificationsEnabled') === 'on' ||
      formData.get('smsNotificationsEnabled') === 'true';
    const pushEnabled =
      formData.get('pushNotificationsEnabled') === 'on' ||
      formData.get('pushNotificationsEnabled') === 'true';
    const voiceEnabled =
      formData.get('voiceNotificationsEnabled') === 'on' ||
      formData.get('voiceNotificationsEnabled') === 'true';
    const whatsappEnabled =
      formData.get('whatsappNotificationsEnabled') === 'on' ||
      formData.get('whatsappNotificationsEnabled') === 'true';

    const hasPhoneField = formData.has('phoneNumber') || formData.has('phoneNumberWhatsApp');
    const submittedPhone = formData.has('phoneNumber')
      ? (formData.get('phoneNumber') as string | null)?.trim() || null
      : formData.has('phoneNumberWhatsApp')
        ? (formData.get('phoneNumberWhatsApp') as string | null)?.trim() || null
        : undefined;
    const effectivePhone = hasPhoneField ? (submittedPhone ?? null) : (user.phoneNumber ?? null);

    if ((smsEnabled || voiceEnabled || whatsappEnabled) && !effectivePhone) {
      return {
        error:
          'A valid phone number is required when SMS, Voice, or WhatsApp notifications are enabled.',
      };
    }

    if (effectivePhone) {
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(effectivePhone)) {
        return { error: 'Phone number must be in E.164 format (e.g., +1234567890)' };
      }
    }

    if (emailEnabled) {
      const emailConfig = await getEmailConfig();
      if (!emailConfig.enabled) {
        return {
          error: 'Email notifications cannot be enabled because no email provider is configured.',
        };
      }
    }

    if (smsEnabled) {
      const smsConfig = await getSMSConfig();
      if (!smsConfig.enabled) {
        return {
          error: 'SMS notifications cannot be enabled because no SMS provider is configured.',
        };
      }
    }

    if (voiceEnabled) {
      const voiceConfig = await getVoiceConfig();
      if (!voiceConfig.enabled) {
        return {
          error: 'Voice notifications cannot be enabled because Twilio Voice is not configured.',
        };
      }
    }

    if (pushEnabled) {
      const pushConfig = await getPushConfig();
      if (!pushConfig.enabled) {
        return {
          error:
            'Push notifications cannot be enabled because no push notification provider is configured.',
        };
      }
    }

    if (whatsappEnabled) {
      const whatsappConfig = await getWhatsAppConfig();
      if (!whatsappConfig.enabled) {
        return {
          error:
            'WhatsApp notifications cannot be enabled because no WhatsApp provider is configured.',
        };
      }
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          emailNotificationsEnabled: emailEnabled,
          smsNotificationsEnabled: smsEnabled,
          voiceNotificationsEnabled: voiceEnabled,
          pushNotificationsEnabled: pushEnabled,
          whatsappNotificationsEnabled: whatsappEnabled,
          ...(hasPhoneField ? { phoneNumber: submittedPhone ?? null } : {}),
        },
      });
      await logAudit(
        {
          action: 'user.notification_preferences.updated',
          entityType: 'USER',
          entityId: user.id,
          actorId: user.id,
          oldValue: {
            emailNotificationsEnabled: user.emailNotificationsEnabled,
            smsNotificationsEnabled: user.smsNotificationsEnabled,
            voiceNotificationsEnabled: user.voiceNotificationsEnabled,
            pushNotificationsEnabled: user.pushNotificationsEnabled,
            whatsappNotificationsEnabled: user.whatsappNotificationsEnabled,
            hasPhoneNumber: Boolean(user.phoneNumber),
          },
          newValue: {
            emailNotificationsEnabled: emailEnabled,
            smsNotificationsEnabled: smsEnabled,
            voiceNotificationsEnabled: voiceEnabled,
            pushNotificationsEnabled: pushEnabled,
            whatsappNotificationsEnabled: whatsappEnabled,
            hasPhoneNumber: Boolean(effectivePhone),
          },
        },
        tx
      );
    });

    revalidatePath('/settings/profile');
    return { success: true };
  } catch (error) {
    logger.error('Error updating notification preferences', {
      component: 'settings-actions',
      error,
    });
    return {
      error: 'Unable to update notification preferences. Please try again.',
    };
  }
}

export async function sendTestNotification(
  channel: 'EMAIL' | 'SMS' | 'VOICE' | 'WHATSAPP' | 'PUSH'
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
    const crypto = await import('crypto');

    if (channel === 'EMAIL') {
      if (!user.email) return { success: false, error: 'No email address configured.' };
      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.email,
        userId: user.id,
        templateKey: 'test-email',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `manual-test-email:${crypto.randomUUID()}`,
        displayMessage: 'Test email notification',
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'EMAIL',
          to: user.email,
          subject: '🔔 OpsKnight: Test Email Alert',
          html: `<p>Hello ${user.name || 'there'},</p><p>This is a test notification confirming that your OpsKnight email alert channel is properly configured and active.</p><p><small>Sent at: ${new Date().toUTCString()}</small></p>`,
          text: `Hello ${user.name || 'there'},\n\nThis is a test notification confirming that your OpsKnight email alert channel is properly configured and active.\n\nSent at: ${new Date().toUTCString()}`,
        },
      });
      return { success: true };
    }

    if (channel === 'SMS') {
      if (!user.phoneNumber) {
        return {
          success: false,
          error: 'Please enter and save a valid phone number in E.164 format first.',
        };
      }
      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'SMS',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.phoneNumber,
        userId: user.id,
        templateKey: 'test-sms',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `manual-test-sms:${crypto.randomUUID()}`,
        displayMessage: 'Test SMS notification',
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'SMS',
          to: user.phoneNumber,
          message:
            '🔔 OpsKnight Test Alert: Your SMS channel is active and receiving incident notifications.',
        },
      });
      return { success: true };
    }

    if (channel === 'VOICE') {
      if (!user.phoneNumber) {
        return {
          success: false,
          error: 'Please enter and save a valid phone number in E.164 format first.',
        };
      }
      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'VOICE',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.phoneNumber,
        userId: user.id,
        templateKey: 'test-voice',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `manual-test-voice:${crypto.randomUUID()}`,
        displayMessage: 'Test voice notification',
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'VOICE',
          to: user.phoneNumber,
          message:
            'This is a test voice call from OpsKnight. Your Twilio voice configuration is working.',
        },
      });
      return { success: true };
    }

    if (channel === 'WHATSAPP') {
      if (!user.phoneNumber) {
        return {
          success: false,
          error: 'Please enter and save a valid WhatsApp phone number in E.164 format first.',
        };
      }
      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'WHATSAPP',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.phoneNumber,
        userId: user.id,
        templateKey: 'test-whatsapp',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `manual-test-whatsapp:${crypto.randomUUID()}`,
        displayMessage: 'Test WhatsApp notification',
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'WHATSAPP',
          to: user.phoneNumber,
          message:
            '🔔 OpsKnight Test Alert: Your WhatsApp notification channel is active and receiving incident alerts.',
        },
      });
      return { success: true };
    }

    if (channel === 'PUSH') {
      const pushConfig = await getPushConfig();
      if (!pushConfig.enabled) {
        return { success: false, error: 'Push notifications are not enabled on the server.' };
      }
      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'PUSH',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.id,
        userId: user.id,
        templateKey: 'test-push',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `manual-test-push:${crypto.randomUUID()}`,
        displayMessage: 'Test push notification',
        priority: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        payload: {
          kind: 'PUSH',
          userId: user.id,
          title: '🔔 OpsKnight Test Alert',
          body: `Hello ${user.name || 'there'}! Your push notification channel is active.`,
          data: { url: '/settings/profile?tab=notifications', type: 'test' },
        },
      });
      return { success: true };
    }

    return { success: false, error: 'Invalid notification channel.' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test notification.',
    };
  }
}

export async function updatePassword(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const currentPassword = (formData.get('currentPassword') as string | null) ?? '';
    const newPassword = (formData.get('newPassword') as string | null) ?? '';
    const confirmPassword = (formData.get('confirmPassword') as string | null) ?? '';

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return { error: passwordError };
    }

    if (newPassword !== confirmPassword) {
      return { error: 'Passwords do not match.' };
    }

    const credentials = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!credentials) return { error: 'User not found.' };

    if (credentials.passwordHash) {
      const valid = await bcrypt.compare(currentPassword, credentials.passwordHash);
      if (!valid) {
        return { error: 'Current password is incorrect.' };
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await revokeUserSessions(user.id);

    await logAudit({
      action: 'user.password.updated',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      details: { method: 'settings' },
    });

    revalidatePath('/settings/security');
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to update password.' };
  }
}

export async function createApiKey(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const name = (formData.get('name') as string | null)?.trim() ?? '';
    const scopes = formData.getAll('scopes').filter(Boolean) as string[];
    const expirationDays = Number(formData.get('expirationDays') || 90);
    const requestedScopes = scopes.filter(isApiScope);
    const canWrite = hasCapability(user.role, CAPABILITIES.OPERATIONS_MANAGE);
    if (!canWrite && requestedScopes.some(isWriteApiScope)) {
      return { error: 'Write scopes require Responder or Admin access.' };
    }
    const finalScopes =
      requestedScopes.length > 0
        ? requestedScopes
        : canWrite
          ? [API_SCOPES.EVENTS_WRITE]
          : [API_SCOPES.INCIDENTS_READ];

    if (!name) {
      return { error: 'Name is required.' };
    }
    if (!Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 365) {
      return { error: 'API keys must expire between 1 and 365 days.' };
    }

    const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);
    const { token, prefix, tokenHash } = generateApiKey();

    await prisma.$transaction(async tx => {
      const key = await tx.apiKey.create({
        data: {
          name,
          prefix,
          tokenHash,
          scopes: finalScopes,
          userId: user.id,
          expiresAt,
        },
      });

      await logAudit(
        {
          action: 'api_key.created',
          entityType: 'API_KEY',
          entityId: key.id,
          actorId: user.id,
          details: { name, prefix, scopes: finalScopes, expiresAt: expiresAt.toISOString() },
        },
        tx
      );
    });

    revalidatePath('/settings/api-keys');
    return { success: true, token };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to create API key.' };
  }
}

export async function revokeApiKey(formData: FormData) {
  const keyId = formData.get('keyId') as string | null;
  if (!keyId) {
    return;
  }

  const user = await getCurrentUser();
  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, userId: true },
  });
  if (!key || (user.role !== 'ADMIN' && key.userId !== user.id)) {
    throw new Error('API key not found or you do not have permission to revoke it.');
  }

  await prisma.$transaction(async tx => {
    const result = await tx.apiKey.updateMany({
      where: {
        id: keyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (result.count === 0) return;

    await logAudit(
      {
        action: 'api_key.revoked',
        entityType: 'API_KEY',
        entityId: keyId,
        actorId: user.id,
        details: { ownerId: key.userId },
      },
      tx
    );
  });

  revalidatePath('/settings/api-keys');
}
