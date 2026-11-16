'use server';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { THEME_CHOICES, preferenceFromThemeChoice } from '@/lib/theme-preference';

export type ThemePreferenceActionResult = { ok: true } | { ok: false; error: string };

const themePreferenceInput = z.object({ choice: z.enum(THEME_CHOICES) }).strict();

/** Persists the signed-in user's appearance choice (System / Light / Dark). */
export async function updateThemePreference(input: unknown): Promise<ThemePreferenceActionResult> {
  const parsed = themePreferenceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Unknown appearance option.' };

  const context = await getRequestActorContext();
  if (!context) return { ok: false, error: 'Your session has expired. Sign in again.' };

  try {
    await prisma.user.update({
      where: { id: context.user.id },
      data: { themePreference: preferenceFromThemeChoice(parsed.data.choice) },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save your appearance preference.' };
  }
}
