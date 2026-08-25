'use server';

import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';

type QuietHoursActionState = {
  error?: string | null;
  success?: boolean;
};

function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function updateQuietHoursPreferences(
  _prevState: QuietHoursActionState,
  formData: FormData
): Promise<QuietHoursActionState> {
  try {
    const session = await getServerSession(await getAuthOptions());
    const email = session?.user?.email;
    if (!email) return { error: 'Unauthorized' };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return { error: 'User not found' };

    const enabled =
      formData.get('quietHoursEnabled') === 'on' ||
      formData.get('quietHoursEnabled') === 'true';
    const weekendAllDay =
      formData.get('quietHoursWeekendAllDay') === 'on' ||
      formData.get('quietHoursWeekendAllDay') === 'true';

    const startValue = String(formData.get('quietHoursStart') || '18:00');
    const endValue = String(formData.get('quietHoursEnd') || '08:00');
    const startMinutes = parseTimeToMinutes(startValue);
    const endMinutes = parseTimeToMinutes(endValue);

    if (startMinutes === null || endMinutes === null) {
      return { error: 'Quiet-hours start and end must be valid times.' };
    }
    if (startMinutes === endMinutes) {
      return { error: 'Quiet-hours start and end must be different.' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        quietHoursEnabled: enabled,
        quietHoursStartMinutes: startMinutes,
        quietHoursEndMinutes: endMinutes,
        quietHoursWeekendAllDay: weekendAllDay,
      },
    });

    revalidatePath('/settings/profile');
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to update quiet-hours preferences.',
    };
  }
}
