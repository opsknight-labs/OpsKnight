'use server';

import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { isThemeChoice, preferenceFromThemeChoice } from '@/lib/theme-preference';

export type ThemePreferenceActionResult = { ok: true } | { ok: false; error: string };

/** Persists the signed-in user's appearance choice (System / Light / Dark). */
export async function updateThemePreference(choice: unknown): Promise<ThemePreferenceActionResult> {
  if (!isThemeChoice(choice)) return { ok: false, error: 'Unknown appearance option.' };

  const context = await getRequestActorContext();
  if (!context) return { ok: false, error: 'Your session has expired. Sign in again.' };

  try {
    await prisma.user.update({
      where: { id: context.user.id },
      data: { themePreference: preferenceFromThemeChoice(choice) },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save your appearance preference.' };
  }
}
