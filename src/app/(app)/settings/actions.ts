'use server';

import prisma from '@/lib/prisma';
import { getAuthOptions, revokeUserSessions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { generateApiKey } from '@/lib/api-keys';
import { validatePasswordStrength } from '@/lib/passwords';
import {
  getEmailConfig,
  getSMSConfig,
  getPushConfig,
  getWhatsAppConfig,
} from '@/lib/notification-providers';
import { logger } from '@/lib/logger';
import { getDefaultAvatar, isDefaultAvatar } from '@/lib/avatar';
import { logAudit } from '@/lib/audit';

type ActionState = {
  error?: string | null;
  success?: boolean;
  token?: string | null;
};

async function getCurrentUser() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email;
  if (!email) {
    throw new Error('Unauthorized');
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

export async function updateProfile(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();

    const avatarFile = formData.get('avatar') as File | null;

    const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

    let avatarUrl = undefined;
    if (avatarFile && avatarFile.size > 0) {
      // Validate file type
      if (!ALLOWED_MIME_TYPES.has(avatarFile.type)) {
        return { error: 'Invalid file type. Please upload a PNG, JPEG, WebP, or GIF image.' };
      }
      if (avatarFile.size > 2 * 1024 * 1024) {
        // 2MB limit
        return { error: 'File size too large. Max 2MB.' };
      }

      try {
        const bytes = await avatarFile.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Verify magic bytes
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

        // Save to database (UserAvatar table)
        await prisma.userAvatar.upsert({
          where: { userId: user.id },
          update: {
            data: buffer,
            mimeType: avatarFile.type,
          },
          create: {
            userId: user.id,
            data: buffer,
            mimeType: avatarFile.type,
          },
        });

        // Set avatarUrl to API route with cache-busting timestamp
        avatarUrl = `/api/users/${user.id}/avatar?t=${Date.now()}`;
      } catch (err) {
        logger.error('Failed to save avatar to database', { error: err });
        return { error: 'Failed to upload profile photo.' };
      }
    }

    const removeAvatar = formData.get('removeAvatar') === 'true';

    // Prepare update data
    const data: Partial<{
      name: string;
      gender: string | null;
      department: string | null;
      jobTitle: string | null;
      avatarUrl: string | null;
    }> = {};

    // Handle Name
    if (formData.has('name')) {
      const n = (formData.get('name') as string | null)?.trim();
      if (n && n.length >= 2) data.name = n;
    }

    // Handle Department & Job Title
    if (formData.has('department')) {
      data.department = (formData.get('department') as string | null)?.trim() || null;
    }
    if (formData.has('jobTitle')) {
      data.jobTitle = (formData.get('jobTitle') as string | null)?.trim() || null;
    }

    // Handle Gender & Smart Avatar Logic
    let newGender = user.gender;
    if (formData.has('gender')) {
      const g = (formData.get('gender') as string | null)?.trim() || null;
      data.gender = g;
      newGender = g;
    }

    // Handle direct avatarUrl (from avatar picker)
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

    // Avatar Logic
    if (removeAvatar) {
      // User explicitly requested removal - clean up DB binary and set to default based on gender
      await prisma.userAvatar.deleteMany({ where: { userId: user.id } });
      data.avatarUrl = getDefaultAvatar(newGender, user.id);
    } else if (directAvatarUrl && isValidDirectUrl(directAvatarUrl)) {
      // User selected an avatar from the picker
      data.avatarUrl = directAvatarUrl;
    } else if (avatarUrl !== undefined) {
      // User uploaded a NEW file
      data.avatarUrl = avatarUrl;
    } else if (data.gender !== undefined) {
      // Gender changed, but no new file uploaded.
      // Check if we should update the avatar to match the new gender.
      const isCurrentDefault = isDefaultAvatar(user.avatarUrl);

      if (isCurrentDefault) {
        const newDefault = getDefaultAvatar(newGender, user.id);
        if (newDefault !== user.avatarUrl) {
          data.avatarUrl = newDefault;
        }
      }
    }

    // If no data to update, return early
    if (Object.keys(data).length === 0) {
      return { success: true };
    }

    await prisma.user.update({
      where: { id: user.id },
      data,
    });

    // Revalidate multiple paths to ensure UI updates everywhere
    revalidatePath('/settings/profile');
    revalidatePath('/settings');
    revalidatePath('/');
    revalidatePath('/incidents');
    revalidatePath('/users');
    revalidatePath('/policies');
    revalidatePath('/schedules');
    // Revalidate layout to update topbar
    revalidatePath('/', 'layout');

    return { success: true };
  } catch (error) {
    logger.error('Error updating profile', { component: 'settings-actions', error });
    return { error: error instanceof Error ? error.message : 'Unable to update profile.' };
  }
}

export async function updatePreferences(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    const timeZone = (formData.get('timeZone') as string | null)?.trim() ?? 'UTC';

    await prisma.user.update({
      where: { id: user.id },
      data: {
        timeZone,
      },
    });

    revalidatePath('/settings/profile');
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to update preferences.' };
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
    const whatsappEnabled =
      formData.get('whatsappNotificationsEnabled') === 'on' ||
      formData.get('whatsappNotificationsEnabled') === 'true';
    // Phone number can come from SMS or WhatsApp field (they share the same number)
    const phoneNumber =
      (formData.get('phoneNumber') as string | null)?.trim() ||
      (formData.get('phoneNumberWhatsApp') as string | null)?.trim() ||
      null;

    // Check provider availability
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

    // Validate phone number if SMS or WhatsApp is enabled
    if ((smsEnabled || whatsappEnabled) && phoneNumber) {
      // Basic E.164 format validation
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phoneNumber)) {
        return { error: 'Phone number must be in E.164 format (e.g., +1234567890)' };
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailNotificationsEnabled: emailEnabled,
        smsNotificationsEnabled: smsEnabled,
        pushNotificationsEnabled: pushEnabled,
        whatsappNotificationsEnabled: whatsappEnabled,
        phoneNumber: smsEnabled || whatsappEnabled ? phoneNumber : null,
      },
    });

    revalidatePath('/settings/profile');
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to update notification preferences.',
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

    if (user.passwordHash) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return { error: 'Current password is incorrect.' };
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    // Revoke all existing sessions after password change (world-class security default).
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
    const allowedScopes = new Set([
      'events:write',
      'incidents:read',
      'incidents:write',
      'services:read',
      'schedules:read',
    ]);
    const finalScopes =
      scopes.length > 0 ? scopes.filter(scope => allowedScopes.has(scope)) : ['events:write'];

    if (!name) {
      return { error: 'Name is required.' };
    }

    const { token, prefix, tokenHash } = generateApiKey();

    await prisma.apiKey.create({
      data: {
        name,
        prefix,
        tokenHash,
        scopes: finalScopes,
        userId: user.id,
      },
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
  await prisma.apiKey.updateMany({
    where: {
      id: keyId,
      userId: user.id,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidatePath('/settings/api-keys');
}
