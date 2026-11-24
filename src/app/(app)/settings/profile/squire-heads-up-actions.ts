'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { HEADS_UP_MAX_LEAD_MINUTES } from '@/lib/intelligence/squire/heads-up';

const schema = z.object({
  enabled: z.boolean(),
  leadMinutes: z.number().int().min(5).max(HEADS_UP_MAX_LEAD_MINUTES),
});

/** The signed-in person's own on-call heads-up: on or off, and how long before the shift. */
export async function setMySquireHeadsUp(input: { enabled: boolean; leadMinutes: number }) {
  const { enabled, leadMinutes } = schema.parse(input);
  const user = await getCurrentUser();
  await prisma.squireUserSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, headsUpEnabled: enabled, headsUpLeadMinutes: leadMinutes },
    update: { headsUpEnabled: enabled, headsUpLeadMinutes: leadMinutes },
  });
  revalidatePath('/settings/profile');
  return { success: true };
}
