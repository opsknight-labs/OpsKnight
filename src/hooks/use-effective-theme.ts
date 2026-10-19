'use client';

import { useTheme } from 'next-themes';

export type EffectiveTheme = 'light' | 'dark';

/**
 * The theme the page is actually painted in.
 *
 * next-themes computes `resolvedTheme` from the *stored* preference and ignores
 * `forcedTheme`. Desktop routes force light, but the mobile theme toggle writes
 * to the same storage key, so a desktop page can report `resolvedTheme: 'dark'`
 * (or `system` → OS dark) while it renders light. Anything that must match the
 * painted UI — toasts, `data-theme`, `color-scheme` — has to use this instead.
 */
export function useEffectiveTheme(): EffectiveTheme {
  const { forcedTheme, resolvedTheme } = useTheme();
  return (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light';
}
