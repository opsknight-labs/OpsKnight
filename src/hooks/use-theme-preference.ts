'use client';

import { useTheme } from 'next-themes';
import { useCallback, useSyncExternalStore } from 'react';
import { notify } from '@/lib/toast';
import { updateThemePreference } from '@/app/theme-actions';
import { isThemeChoice, type ThemeChoice } from '@/lib/theme-preference';
import { useEffectiveTheme, type EffectiveTheme } from '@/hooks/use-effective-theme';

const emptySubscribe = () => () => {};

export type ThemePreferenceState = {
  /** The stored choice; `system` until mounted so SSR and hydration agree. */
  choice: ThemeChoice;
  /** The theme the page is painted in. */
  effective: EffectiveTheme;
  /** What "System" currently resolves to on this device. */
  systemTheme: EffectiveTheme;
  mounted: boolean;
  /** True when the current route pins its theme (e.g. public pages). */
  locked: boolean;
  setChoice: (choice: ThemeChoice) => void;
};

/**
 * Read and change the appearance preference. Changes apply instantly on this
 * device (and other tabs through storage events) and are saved to the account
 * so they follow the user to other browsers and devices.
 */
export function useThemePreference(): ThemePreferenceState {
  const { theme, systemTheme, forcedTheme, setTheme } = useTheme();
  const effective = useEffectiveTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      setTheme(next);
      void updateThemePreference(next)
        .then(result => {
          if (!result.ok) notify.error(result.error);
        })
        .catch(() => notify.error('Could not save your appearance preference.'));
    },
    [setTheme]
  );

  return {
    choice: mounted && isThemeChoice(theme) ? theme : 'system',
    effective,
    systemTheme: systemTheme === 'dark' ? 'dark' : 'light',
    mounted,
    locked: Boolean(forcedTheme),
    setChoice,
  };
}
