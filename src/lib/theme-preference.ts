/**
 * Shared theme-preference contract.
 *
 * The account preference (`User.themePreference`) is the source of truth and
 * follows the user across devices. next-themes keeps a per-browser copy in
 * localStorage so the blocking pre-paint script can apply it before first
 * paint and so tabs stay in sync through the `storage` event.
 */
export const THEME_STORAGE_KEY = 'theme';

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ThemePreferenceValue = 'SYSTEM' | 'LIGHT' | 'DARK';

/** Browser chrome (`theme-color`) per painted theme; matches --ui-background. */
export const THEME_CHROME_COLORS = {
  light: '#f8fafc',
  dark: '#09090b',
} as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

export function themeChoiceFromPreference(
  preference: ThemePreferenceValue | null | undefined
): ThemeChoice {
  if (preference === 'LIGHT') return 'light';
  if (preference === 'DARK') return 'dark';
  return 'system';
}

export function preferenceFromThemeChoice(choice: ThemeChoice): ThemePreferenceValue {
  if (choice === 'light') return 'LIGHT';
  if (choice === 'dark') return 'DARK';
  return 'SYSTEM';
}

/**
 * Inline, render-blocking script that reconciles the browser copy with the
 * account preference before the authenticated shell paints. It only touches
 * the DOM when the stored value differs (new device, or changed elsewhere).
 */
export function accountThemeSyncScript(choice: ThemeChoice): string {
  return `(function(){try{var p=${JSON.stringify(choice)},k=${JSON.stringify(
    THEME_STORAGE_KEY
  )};if(localStorage.getItem(k)===p)return;localStorage.setItem(k,p);var d=document.documentElement,r=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;d.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r;d.setAttribute("data-theme",r);var m=document.getElementById("opsknight-runtime-theme-color");if(m)m.setAttribute("content",r==="dark"?${JSON.stringify(
    THEME_CHROME_COLORS.dark
  )}:${JSON.stringify(THEME_CHROME_COLORS.light)});}catch(e){}})();`;
}

/**
 * Head script: paints browser/PWA chrome in the right colour before hydration
 * and mirrors the theme to data-theme for legacy selectors. next-themes'
 * own script applies the class; this one only covers what it does not.
 * Light-pinned routes always resolve to light.
 */
export function chromeThemeBootstrapScript(lightPinnedPrefixes: readonly string[]): string {
  return `(function(){try{var p=location.pathname,pin=${JSON.stringify(
    lightPinnedPrefixes
  )}.some(function(x){return p===x||p.indexOf(x+"/")===0});var s=null;try{s=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
  )})}catch(e){}var dark=!pin&&(s==="dark"||((!s||s==="system")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));var r=dark?"dark":"light",d=document.documentElement;d.setAttribute("data-theme",r);var m=document.getElementById("opsknight-runtime-theme-color");if(m)m.setAttribute("content",dark?${JSON.stringify(
    THEME_CHROME_COLORS.dark
  )}:${JSON.stringify(THEME_CHROME_COLORS.light)});}catch(e){}})();`;
}
